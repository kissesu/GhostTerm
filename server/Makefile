# GhostTerm Progress Server — 构建/生成入口
# @author Atlas.oi
# @date   2026-04-29

.PHONY: gen gen-server gen-types build test vet tidy

# 默认目标：同时生成后端 server 和前端 types
gen: gen-server gen-types

# 用 ogen 从 openapi.yaml 重新生成 internal/api/oas/*.go
gen-server:
	go generate ./...

# 用 openapi-typescript 生成前端 types（占位，由 Phase 0c 子任务激活）。
# 当前 Phase 0a 不强制运行，避免引入 pnpm 顺序依赖；前端 worker 在自己的 phase 内执行。
gen-types:
	@echo "[gen-types] 占位：Phase 0c 由前端 subagent 执行"
	@echo "  pnpm openapi-typescript server/openapi.yaml -o src/features/progress/api/types.gen.ts"
	@echo "  pnpm openapi-zod-client  server/openapi.yaml -o src/features/progress/api/schemas.gen.ts"

build:
	go build ./...

vet:
	go vet ./...

test:
	go test ./...

# go.mod 整理（注意：不要在 go generate 之后立即跑，
# 否则 ogen 的 indirect 依赖会被 tidy 移除，导致下次 generate 失败）
tidy:
	go mod tidy
