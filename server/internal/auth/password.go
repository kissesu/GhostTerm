/*
@file password.go
@description bcrypt 密码哈希封装。
             - HashPassword: 用配置的 cost（默认 12）对明文密码哈希入库
             - VerifyPassword: 校验明文密码与已存入的 bcrypt 哈希是否匹配（恒定时间比较）
             所有密码字段（users.password_hash）由本文件统一处理，禁止业务代码直接调
             bcrypt 包以避免 cost 不一致 / 误用 CompareHashAndPassword 等问题。
@author Atlas.oi
@date 2026-04-29
*/

package auth

import (
	"errors"
	"fmt"

	"golang.org/x/crypto/bcrypt"
)

// 业务背景：bcrypt 自身限制单次输入最长 72 字节，超过会被静默截断。
// 我们在 HashPassword 入口显式拒绝超长输入，避免"用户改了 200 字符密码但只有前 72 字符生效"
// 的安全坑（OWASP ASVS V2.1.4）。
const maxPasswordBytes = 72

// ErrPasswordTooLong 表示明文密码超过 bcrypt 单次 72 字节上限。
//
// 业务侧需要把这个错误映射为用户可读提示（如"密码过长，请控制在 72 字节内"），
// 而不是粗暴 500。spec §3.4 的 password 校验规则在 handler 层做，这里仅守护底层。
var ErrPasswordTooLong = errors.New("auth: password exceeds 72 bytes")

// HashPassword 用 bcrypt + 指定 cost 计算明文密码哈希。
//
// 业务流程：
//  1. 拒绝空字符串（避免数据库出现"空 hash"误存）
//  2. 拒绝超过 72 字节的输入（防止 bcrypt 静默截断）
//  3. 调 bcrypt.GenerateFromPassword；cost < bcrypt.MinCost(=4) 时由 bcrypt 自身报错
//
// 设计取舍：
//   - cost 由调用方（service 层从 config.BcryptCost 读取）注入，
//     不在本文件硬编码，便于"开发态用 4 加快测试 / 生产用 12"
func HashPassword(plain string, cost int) (string, error) {
	if plain == "" {
		return "", errors.New("auth: password is empty")
	}
	if len(plain) > maxPasswordBytes {
		return "", ErrPasswordTooLong
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), cost)
	if err != nil {
		return "", fmt.Errorf("auth: bcrypt hash: %w", err)
	}
	return string(hash), nil
}

// VerifyPassword 用 bcrypt 恒定时间比较明文与 hash。
//
// 返回 bool（不是 error）的设计意图：
//   - 验证失败 = 密码错；验证成功 = 密码对。两种结果都是合法业务状态，不算错误
//   - 业务侧只需 if !VerifyPassword(...) { return unauthorized } 即可
//   - hash 格式异常（不是合法 bcrypt 串）也返回 false，等价于"密码不匹配"，
//     避免攻击者通过精心构造的 hash 触发 5xx 区分用户是否存在
func VerifyPassword(plain, hash string) bool {
	if plain == "" || hash == "" {
		return false
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)); err != nil {
		return false
	}
	return true
}
