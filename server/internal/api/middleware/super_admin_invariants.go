/*
@file super_admin_invariants.go
@description chi 兼容中间件：在请求到达 handler/DB 之前拦截可能违反"超管不可改"约束的写入。

             plan §0.5 三层防御策略：
               L1 DB triggers（migration 0007）—— 最终兜底，但只能 RAISE → HTTP 500
               L2 Service 层（待 Task 6/7）   —— 业务校验
               L3 本中间件                   —— 友好 422 super_admin_immutable，免去 500

             路由级覆盖：本中间件按 r.URL.Path + r.Method 自行解析 path 段，不依赖 chi.URLParam，
             因此可挂在 ogen Mount 之前的任意位置（参 router.go 中 r.Use 的位置）。

             plan §0.5 列出的 4 类拦截场景：
               1. POST  /api/users                                body.roleId == 1
               2. PATCH /api/users/{id}                           body.roleId == 1
               3. PATCH /api/roles/{id}/permissions               path id == 1
               4. DELETE /api/roles/{id}                          path id == 1
               + bonus: PATCH /api/users/{id}/permission-overrides  users.role_id of {id} == 1
                        (Task 7 才有该路由，本中间件已就绪)

             错误响应格式（与 auth.go writeUnauthorized 同 envelope）：
               { "error": { "code": "super_admin_immutable", "message": "..." } }
               HTTP 422 Unprocessable Entity

@author Atlas.oi
@date 2026-05-02
*/

package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// 超管 role_id 哨兵：与 migration 0001 seed + 0007 触发器中硬编码一致
const superAdminRoleID int64 = 1

// API 路由 prefix 中央化常量；调整 mount 位置时仅改此处即可
const apiPrefix = "/api"

// 管理类用户写入 body 上限：64KiB 远高于真实 payload，能挡住恶意巨大 body 拖垮内存
const maxAdminBodyBytes = 64 * 1024

// errAdminBodyTooLarge 用于在 peekRoleID 返回时让 Handler 决定如何回应（413 vs 422）。
// 业务背景：MaxBytesReader 返回 *http.MaxBytesError；errors.Is 对 sentinel 更稳，单独包装一层
// 让 caller 不依赖 net/http 的具体错误类型变化。
var errAdminBodyTooLarge = errors.New("admin request body exceeds size limit")

// SuperAdminInvariants 是 chi 兼容中间件的依赖载体。
//
// 业务背景：
//   - 规则 #5 需要 lookup users.role_id of target id，必须持有 *pgxpool.Pool
//   - 不持有 service 层是有意为之：本中间件是"安全网"，越少依赖越不易因服务重构被误伤
type SuperAdminInvariants struct {
	pool *pgxpool.Pool
}

// NewSuperAdminInvariants 构造函数。pool 必须为非 nil（启动期校验由调用方负责）。
func NewSuperAdminInvariants(pool *pgxpool.Pool) *SuperAdminInvariants {
	return &SuperAdminInvariants{pool: pool}
}

// Handler 返回 chi 兼容的 middleware：func(next http.Handler) http.Handler。
//
// 业务流程（按 plan §0.5 决策序）：
//  1. 仅对写方法生效（POST/PATCH/PUT/DELETE）；GET/HEAD/OPTIONS 直接放行
//  2. 路径 trailing-slash 归一化，避免 /api/users/2/ 绕过匹配
//  3. 路径形态匹配 → 进入对应规则；不匹配则放行（避免误伤无关 endpoint）
//  4. 任一规则命中 → 422 super_admin_immutable + next 不调用
//  5. 任一规则放行 → next.ServeHTTP（必要时 body 已被 reset 让下游能完整读到）
func (m *SuperAdminInvariants) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method := r.Method

		// 只关心写方法；读方法不会变更状态
		if method != http.MethodPost && method != http.MethodPatch &&
			method != http.MethodPut && method != http.MethodDelete {
			next.ServeHTTP(w, r)
			return
		}

		// 归一化路径：去掉单个/多个尾随 "/"；空路径还原为 "/"。
		// 业务背景：/api/users/2 与 /api/users/2/ 语义等价，但 strings.HasPrefix/HasSuffix
		// 严格按字面比较；不归一化则 trailing slash 即可绕过整套拦截。
		path := strings.TrimRight(r.URL.Path, "/")
		if path == "" {
			path = "/"
		}

		// ============================================================
		// 规则 1 + 2：POST /api/users 或 PATCH/PUT /api/users/{id}
		// 拦截 body.roleId == 1
		//
		// 注意：/api/users/{id}/permission-overrides 也匹配 /api/users/{id} 前缀，
		// 因此先精确判断"末段是否为纯数字"再触发本规则；overrides 走规则 5。
		// ============================================================
		if isUsersWriteEndpoint(method, path) {
			roleID, ok, err := peekRoleID(w, r)
			if err != nil {
				if errors.Is(err, errAdminBodyTooLarge) {
					// body 超限走 413：语义最贴合，且与 Go 标准 MaxBytesReader 错误链一致
					writeRequestEntityTooLarge(w, "请求体过大，超过管理接口允许的最大值")
					return
				}
				// body 解析失败（malformed JSON）—— 让下游 handler 给 400，本中间件不越权
				next.ServeHTTP(w, r)
				return
			}
			if ok && roleID == superAdminRoleID {
				writeSuperAdminImmutable(w, "禁止创建或修改 super_admin 角色的用户")
				return
			}
			// body 必须 reset 给下游
			next.ServeHTTP(w, r)
			return
		}

		// ============================================================
		// 规则 3：PATCH/PUT /api/roles/{id}/permissions —— 拦截 id == 1
		// ============================================================
		if isRolePermissionsWriteEndpoint(method, path) {
			id, ok := extractRoleID(path, apiPrefix+"/roles/", "/permissions")
			if ok && id == superAdminRoleID {
				writeSuperAdminImmutable(w, "禁止修改 super_admin 角色的权限绑定")
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		// ============================================================
		// 规则 4：DELETE /api/roles/{id} —— 拦截 id == 1
		// ============================================================
		if method == http.MethodDelete && isRoleDeleteEndpoint(path) {
			id, ok := extractTrailingID(path, apiPrefix+"/roles/")
			if ok && id == superAdminRoleID {
				writeSuperAdminImmutable(w, "禁止删除 super_admin 角色")
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		// ============================================================
		// 规则 5：PATCH/PUT /api/users/{id}/permission-overrides
		// 需要 lookup users.role_id of {id}；命中超管即拦截
		// ============================================================
		if isUserPermissionOverridesEndpoint(method, path) {
			id, ok := extractRoleID(path, apiPrefix+"/users/", "/permission-overrides")
			if ok {
				targetRole, found, err := m.lookupUserRoleID(r.Context(), id)
				if err != nil {
					// DB 异常不能 fail-open（让超管覆写溜过去）；记录原始错误后回 503
					// 让前端有明确"重试/反馈"路径，运维通过日志能定位真实根因。
					log.Printf("super_admin_invariants: db error looking up user %d: %v", id, err)
					writeServiceUnavailable(w, "用户角色查询失败，请稍后重试")
					return
				}
				if found && targetRole == superAdminRoleID {
					writeSuperAdminImmutable(w, "禁止覆写 super_admin 用户的权限")
					return
				}
				// 用户不存在 → 让下游 handler 给 404，本中间件不越权
			}
			next.ServeHTTP(w, r)
			return
		}

		// 无任何规则匹配 —— 放行
		next.ServeHTTP(w, r)
	})
}

// ============================================================
// 路径模式 helper
// ============================================================

// isUsersWriteEndpoint 判定路径是否是 users 创建/修改 endpoint：
//   - POST /api/users
//   - PATCH/PUT /api/users/{id}（id 必须为纯数字，避免误匹配 /api/users/{id}/sub-resource）
func isUsersWriteEndpoint(method, path string) bool {
	switch method {
	case http.MethodPost:
		return path == apiPrefix+"/users"
	case http.MethodPatch, http.MethodPut:
		// /api/users/{id} —— 末段必须是纯数字 id，且不能再有子路径
		prefix := apiPrefix + "/users/"
		if !strings.HasPrefix(path, prefix) {
			return false
		}
		rest := path[len(prefix):]
		// rest 必须是纯数字，无 "/"；否则可能是 /permission-overrides 子路由
		if rest == "" || strings.Contains(rest, "/") {
			return false
		}
		_, err := strconv.ParseInt(rest, 10, 64)
		return err == nil
	}
	return false
}

// isRolePermissionsWriteEndpoint 判定 PATCH/PUT /api/roles/{id}/permissions
func isRolePermissionsWriteEndpoint(method, path string) bool {
	if method != http.MethodPatch && method != http.MethodPut {
		return false
	}
	return strings.HasPrefix(path, apiPrefix+"/roles/") && strings.HasSuffix(path, "/permissions")
}

// isRoleDeleteEndpoint 判定 path 形如 /api/roles/{id}（无后缀）
func isRoleDeleteEndpoint(path string) bool {
	prefix := apiPrefix + "/roles/"
	if !strings.HasPrefix(path, prefix) {
		return false
	}
	rest := path[len(prefix):]
	if rest == "" || strings.Contains(rest, "/") {
		return false
	}
	_, err := strconv.ParseInt(rest, 10, 64)
	return err == nil
}

// isUserPermissionOverridesEndpoint 判定 PATCH/PUT /api/users/{id}/permission-overrides
func isUserPermissionOverridesEndpoint(method, path string) bool {
	if method != http.MethodPatch && method != http.MethodPut {
		return false
	}
	return strings.HasPrefix(path, apiPrefix+"/users/") && strings.HasSuffix(path, "/permission-overrides")
}

// extractRoleID 从形如 /api/roles/{id}/permissions 或 /api/users/{id}/permission-overrides
// 中抠出 {id}。
func extractRoleID(path, prefix, suffix string) (int64, bool) {
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return 0, false
	}
	mid := path[len(prefix) : len(path)-len(suffix)]
	if mid == "" || strings.Contains(mid, "/") {
		return 0, false
	}
	id, err := strconv.ParseInt(mid, 10, 64)
	if err != nil {
		return 0, false
	}
	return id, true
}

// extractTrailingID 从形如 /api/roles/{id} 中抠出 {id}（末尾无 suffix）
func extractTrailingID(path, prefix string) (int64, bool) {
	if !strings.HasPrefix(path, prefix) {
		return 0, false
	}
	rest := path[len(prefix):]
	if rest == "" || strings.Contains(rest, "/") {
		return 0, false
	}
	id, err := strconv.ParseInt(rest, 10, 64)
	if err != nil {
		return 0, false
	}
	return id, true
}

// ============================================================
// Body / DB 查询 helper
// ============================================================

// peekRoleID 偷看 request body 的 roleId 字段；读完必须把 body 重置回去给下游 handler。
//
// 业务背景：
//   - net/http 的 r.Body 是 io.ReadCloser 单次消费流；中间件读完不 reset，下游 handler 读到空流会 400/500
//   - OAS UserCreateRequest / UserUpdateRequest 的 JSON 字段名是 camelCase "roleId"（见 openapi.yaml）
//   - 用 http.MaxBytesReader 包裹 body：恶意 32MB JSON 也只读前 64KiB，避免 DoS
//
// 返回 (roleID, ok, err)：
//   - ok=false 表示 body 不含 roleId 字段（PATCH 部分字段场景）
//   - err == errAdminBodyTooLarge 表示 body 超限 —— Handler 应直接 413
//   - err != nil 且非 size 错误 表示 body 读/解析失败 —— 调用方让下游 handler 处理
func peekRoleID(w http.ResponseWriter, r *http.Request) (int64, bool, error) {
	if r.Body == nil {
		return 0, false, nil
	}

	// 限制单次读取上限。即使下游 handler 重新读 body，也只能读到我们已经缓存的 raw（见下方 reset）
	r.Body = http.MaxBytesReader(w, r.Body, maxAdminBodyBytes)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		// MaxBytesReader 在超限时返回 *http.MaxBytesError；统一映射到 sentinel
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return 0, false, errAdminBodyTooLarge
		}
		return 0, false, err
	}
	// 立即 reset body：无论后续是否拒绝，下游链路都依赖 body 完整
	r.Body = io.NopCloser(bytes.NewReader(raw))

	if len(raw) == 0 {
		return 0, false, nil
	}

	var sniff struct {
		RoleID *int64 `json:"roleId"`
	}
	if err := json.Unmarshal(raw, &sniff); err != nil {
		return 0, false, err
	}
	if sniff.RoleID == nil {
		return 0, false, nil
	}
	return *sniff.RoleID, true, nil
}

// lookupUserRoleID 查询 users.role_id（用于规则 5）。
//
// 返回 (roleID, found, err)：
//   - found=false + err=nil 表示用户不存在；caller 放行让下游 handler 返 404
//   - err != nil 表示真实 DB 错误（连接断/超时等）；caller 必须 fail-closed 返 503
//     业务背景：fail-open 会让"权限覆写 super_admin"溜过本层防御，违反 plan §0.5 原则
func (m *SuperAdminInvariants) lookupUserRoleID(ctx context.Context, userID int64) (int64, bool, error) {
	var roleID int64
	err := m.pool.QueryRow(ctx, `SELECT role_id FROM users WHERE id = $1`, userID).Scan(&roleID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, false, nil
		}
		return 0, false, err
	}
	return roleID, true, nil
}

// ============================================================
// 错误响应
// ============================================================

// writeSuperAdminImmutable 输出 422 + ErrorEnvelope JSON。
//
// envelope.error.code 固定为 "super_admin_immutable"（plan §0.5 约定）。
// 注：当前 OAS error code 枚举 (ErrorEnvelopeErrorCode) 还没列入 "super_admin_immutable"；
// 中间件直写字符串与 auth.go writeUnauthorized 同模式，前端按 code 字段断言即可。
// Task 7 OAS 扩展时再把该 code 加入枚举即可向后兼容。
func writeSuperAdminImmutable(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnprocessableEntity)
	body := map[string]any{
		"error": map[string]any{
			"code":    "super_admin_immutable",
			"message": msg,
		},
	}
	_ = json.NewEncoder(w).Encode(body)
}

// writeRequestEntityTooLarge 输出 413 + ErrorEnvelope JSON。
//
// 业务背景：管理接口 body 远小于 64KiB，超限即视为攻击或客户端 bug；用 413 比 422 更准确。
func writeRequestEntityTooLarge(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusRequestEntityTooLarge)
	body := map[string]any{
		"error": map[string]any{
			"code":    "request_body_too_large",
			"message": msg,
		},
	}
	_ = json.NewEncoder(w).Encode(body)
}

// writeServiceUnavailable 输出 503 + ErrorEnvelope JSON。
//
// 业务背景：DB 短暂不可用时返 503 让前端能够清晰地走"重试"分支；
// 与 fail-open（放行让下游处理）相比更安全，避免规则 5 失效。
func writeServiceUnavailable(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusServiceUnavailable)
	body := map[string]any{
		"error": map[string]any{
			"code":    "service_unavailable",
			"message": msg,
		},
	}
	_ = json.NewEncoder(w).Encode(body)
}
