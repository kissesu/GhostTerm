//go:build tools
// +build tools

/*
@file tools.go
@description go generate 用工具版本固化（ogen），通过 build tag 排除正常构建
@author Atlas.oi
@date 2026-04-29
*/

package main

// 通过 blank import + go.mod 固化 ogen CLI 版本，避免不同开发者本地版本漂移。
// 真正调用在 server/internal/api/gen.go 的 //go:generate 指令（go run github.com/ogen-go/ogen/cmd/ogen）。
//
// 注意：现代 Go 禁止 import 一个 main 包，所以这里不能直接 import cmd/ogen。
// 改为 import ogen 库根包（CLI 的 main 函数最终调用 gen 包），效果一致：
// 只要 go.mod 锁定 ogen 版本，go run cmd/ogen 也会从同一版本运行。
import (
	_ "github.com/ogen-go/ogen/gen"
)
