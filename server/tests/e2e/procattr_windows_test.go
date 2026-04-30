/*
@file procattr_windows.go
@description Windows 下 SysProcAttr 占位（不需要 Setpgid 等价物，returns nil）。
@author Atlas.oi
@date 2026-04-29
*/

//go:build windows

package e2e

import "syscall"

// procAttr Windows 下不做特殊处理，返回 nil。
func procAttr() *syscall.SysProcAttr {
	return nil
}
