/*
@file procattr_unix.go
@description Unix-only SysProcAttr：让 server 子进程脱离当前 process group，
             避免 testing 框架收到 SIGINT 时同步杀掉子进程导致清理失败。
@author Atlas.oi
@date 2026-04-29
*/

//go:build !windows

package e2e

import "syscall"

// procAttr 返回 Unix 下用于 server 子进程的 SysProcAttr。
//
// 设计取舍：Setpgid=true 让子进程独立 process group。
// TestMain 退出时只通过 SIGTERM/SIGKILL 显式杀，避免 SIGINT 沿 group 传播
// 把 dockertest cleanup 中途打断。
func procAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true}
}
