# GhostTerm Progress Server — 构建/生成入口
# @author Atlas.oi
# @date   2026-04-29

.PHONY: gen gen-server gen-types build test vet tidy

# 默认目标：同时生成后端 server 和前端 types
gen: gen-server gen-types

# 用 ogen 从 openapi.yaml 重新生成 internal/api/oas/*.go
gen-server:
	go generate ./...

# 用 openapi-typescript 生成前端 types（Phase 0c 已激活）。
# 通过仓库根的 pnpm script `gen-progress-types` 调用，确保依赖与版本由 root package.json 统一管理。
# 注意：Makefile 在 server/ 子目录下执行，需要先 cd 回仓库根。
gen-types:
	cd .. && pnpm gen-progress-types

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
