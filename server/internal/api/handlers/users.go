/*
@file users.go
@description 超管用户管理 HTTP handler 实现（ogen Handler 接口的 4 个 Users* 方法）：
             - UsersList   GET    /api/users
             - UsersCreate POST   /api/users
             - UsersUpdate PATCH  /api/users/{id}
             - UsersDelete DELETE /api/users/{id}

             仅 admin（roleID == 1）可调用；handler 入口校验 AuthContext.RoleID。
             所有错误统一映射为 ErrorEnvelope；UserService 业务错误（taken / not_found / invalid_input）
             分别映射为 422 / 404 / 422。
@author Atlas.oi
@date 2026-04-29
*/

package handlers

import (
	"context"
	"errors"
	"fmt"

	"github.com/ghostterm/progress-server/internal/api/middleware"
	"github.com/ghostterm/progress-server/internal/api/oas"
	"github.com/ghostterm/progress-server/internal/services"
)

// UsersHandler 实现 ogen oas.Handler 中 4 个 Users* 方法。
//
// 业务背景：
//   - 仅超管使用（roleID == 1）；handler 入口统一做 admin 校验，service 不再次校验
//   - 与 AuthHandler 不重叠：AuthHandler 处理"自己的"账户操作（login/me），
//     UsersHandler 处理"别人的"账户管理（admin CRUD）
type UsersHandler struct {
	Svc services.UserService
}

// NewUsersHandler 构造 UsersHandler。
func NewUsersHandler(svc services.UserService) *UsersHandler {
	return &UsersHandler{Svc: svc}
}

// requireAdmin 抽出 AuthContext 并校验是否为超管（roleID==1）。
//
// 业务背景：4 个 Users* 方法都需要相同的"已登录 + 是超管"前置；提取 helper 避免重复。
// 返回值约定：第二个返回值不为 nil 时调用方应直接返回（错误响应已构造好）。
func requireAdmin(ctx context.Context) (services.AuthContext, *oas.ErrorEnvelope) {
	ac, ok := middleware.AuthContextFrom(ctx)
	if !ok {
		e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeUnauthorized, "未登录")
		return services.AuthContext{}, &e
	}
	if ac.RoleID != 1 {
		e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodePermissionDenied, "仅超管可访问用户管理")
		return services.AuthContext{}, &e
	}
	return ac, nil
}

// ============================================================
// UsersList — GET /api/users
// ============================================================

// UsersList 列出系统全部用户（超管用）。
func (h *UsersHandler) UsersList(ctx context.Context) (oas.UsersListRes, error) {
	if _, errEnv := requireAdmin(ctx); errEnv != nil {
		// roleID 错误用 403；未登录用 401。两个 res 类型都是 ErrorEnvelope alias
		if errEnv.Error.Code == oas.ErrorEnvelopeErrorCodeUnauthorized {
			r := oas.UsersListUnauthorized(*errEnv)
			return &r, nil
		}
		r := oas.UsersListForbidden(*errEnv)
		return &r, nil
	}

	users, err := h.Svc.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("users handler: list: %w", err)
	}
	return &oas.UserListResponse{Data: toOASUserList(users)}, nil
}

// ============================================================
// UsersCreate — POST /api/users
// ============================================================

// UsersCreate 创建用户（超管用）。
func (h *UsersHandler) UsersCreate(ctx context.Context, req *oas.UserCreateRequest) (oas.UsersCreateRes, error) {
	if _, errEnv := requireAdmin(ctx); errEnv != nil {
		if errEnv.Error.Code == oas.ErrorEnvelopeErrorCodeUnauthorized {
			r := oas.UsersCreateUnauthorized(*errEnv)
			return &r, nil
		}
		r := oas.UsersCreateForbidden(*errEnv)
		return &r, nil
	}
	if req == nil {
		e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, "请求体缺失")
		r := oas.UsersCreateUnprocessableEntity(e)
		return &r, nil
	}

	in := services.UserCreateInput{
		Username: req.Username,
		Password: req.Password,
		RoleID:   req.RoleId,
	}
	if req.DisplayName.Set {
		v := req.DisplayName.Value
		in.DisplayName = &v
	}

	u, err := h.Svc.Create(ctx, in)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrUsernameTaken):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, "用户名已存在")
			r := oas.UsersCreateUnprocessableEntity(e)
			return &r, nil
		case errors.Is(err, services.ErrInvalidUserInput):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, err.Error())
			r := oas.UsersCreateUnprocessableEntity(e)
			return &r, nil
		default:
			return nil, fmt.Errorf("users handler: create: %w", err)
		}
	}
	return &oas.UserResponse{Data: toOASUserView(u)}, nil
}

// ============================================================
// UsersUpdate — PATCH /api/users/{id}
// ============================================================

// UsersUpdate 修改用户（超管用）。
func (h *UsersHandler) UsersUpdate(ctx context.Context, req *oas.UserUpdateRequest, params oas.UsersUpdateParams) (oas.UsersUpdateRes, error) {
	if _, errEnv := requireAdmin(ctx); errEnv != nil {
		if errEnv.Error.Code == oas.ErrorEnvelopeErrorCodeUnauthorized {
			r := oas.UsersUpdateUnauthorized(*errEnv)
			return &r, nil
		}
		r := oas.UsersUpdateForbidden(*errEnv)
		return &r, nil
	}
	if req == nil {
		e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, "请求体缺失")
		r := oas.UsersUpdateUnprocessableEntity(e)
		return &r, nil
	}

	in := services.UserUpdateInput{}
	if req.Username.Set {
		v := req.Username.Value
		in.Username = &v
	}
	if req.Password.Set {
		v := req.Password.Value
		in.Password = &v
	}
	if req.DisplayName.Set {
		v := req.DisplayName.Value
		in.DisplayName = &v
	}
	if req.RoleId.Set {
		v := req.RoleId.Value
		in.RoleID = &v
	}
	if req.IsActive.Set {
		v := req.IsActive.Value
		in.IsActive = &v
	}

	u, err := h.Svc.Update(ctx, params.ID, in)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrUserNotFound):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, "用户不存在")
			r := oas.UsersUpdateNotFound(e)
			return &r, nil
		case errors.Is(err, services.ErrUsernameTaken):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, "用户名已存在")
			r := oas.UsersUpdateUnprocessableEntity(e)
			return &r, nil
		case errors.Is(err, services.ErrInvalidUserInput):
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeValidationFailed, err.Error())
			r := oas.UsersUpdateUnprocessableEntity(e)
			return &r, nil
		default:
			return nil, fmt.Errorf("users handler: update: %w", err)
		}
	}
	return &oas.UserResponse{Data: toOASUserView(u)}, nil
}

// ============================================================
// UsersDelete — DELETE /api/users/{id}
// ============================================================

// UsersDelete 软删除用户（超管用）。
func (h *UsersHandler) UsersDelete(ctx context.Context, params oas.UsersDeleteParams) (oas.UsersDeleteRes, error) {
	ac, errEnv := requireAdmin(ctx)
	if errEnv != nil {
		if errEnv.Error.Code == oas.ErrorEnvelopeErrorCodeUnauthorized {
			r := oas.UsersDeleteUnauthorized(*errEnv)
			return &r, nil
		}
		r := oas.UsersDeleteForbidden(*errEnv)
		return &r, nil
	}

	// 防自删：超管不能删除自己（避免误操作锁定整个系统）
	if ac.UserID == params.ID {
		e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodePermissionDenied, "不能删除当前登录用户")
		r := oas.UsersDeleteForbidden(e)
		return &r, nil
	}

	if err := h.Svc.Delete(ctx, params.ID); err != nil {
		if errors.Is(err, services.ErrUserNotFound) {
			e := newErrorEnvelope(oas.ErrorEnvelopeErrorCodeNotFound, "用户不存在")
			r := oas.UsersDeleteNotFound(e)
			return &r, nil
		}
		return nil, fmt.Errorf("users handler: delete: %w", err)
	}
	return &oas.UsersDeleteNoContent{}, nil
}

// ============================================================
// 辅助：service.UserView → oas.User
// ============================================================

func toOASUserView(u services.UserView) oas.User {
	// Permissions 显式给空切片而非 nil：
	// 业务背景：oas.User.Permissions 用 json:"permissions" 必填序列化；
	//   nil slice 会编码成 "permissions": null，前端 zod schema
	//   z.array(z.string()).optional().default([]) 不接受 null（仅接受 undefined），
	//   会导致整列响应解析失败。Atlas 用户管理列表无需展示 permissions，
	//   但为了字段稳定一律返回空数组。
	return oas.User{
		ID:          u.ID,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		RoleId:      u.RoleID,
		IsActive:    u.IsActive,
		CreatedAt:   u.CreatedAt,
		Permissions: []string{},
	}
}

func toOASUserList(us []services.UserView) []oas.User {
	out := make([]oas.User, 0, len(us))
	for _, u := range us {
		out = append(out, toOASUserView(u))
	}
	return out
}
