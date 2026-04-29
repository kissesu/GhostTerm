/*
@file gen.go
@description ogen 代码生成入口；运行 go generate ./... 时调用 ogen CLI 把 openapi.yaml 编译为 oas/ 包
@author Atlas.oi
@date 2026-04-29
*/

package api

// 为什么不用 //go:generate ogen 而是 go run ：
//   1. 用 go run github.com/ogen-go/ogen/cmd/ogen 强制走 go.mod 固化的版本（与 tools.go import 一致），避免本机 PATH 上的 ogen 漂移
//   2. --target 路径相对当前文件（internal/api/）→ oas/ 即 internal/api/oas/
//   3. --clean 每次重建，避免遗留陈旧文件
//go:generate go run github.com/ogen-go/ogen/cmd/ogen --target oas --package oas --clean ../../openapi.yaml
