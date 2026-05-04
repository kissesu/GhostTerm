/**
 * @file ProfileDialog.tsx
 * @description 个人中心 modal —— 当前登录用户自助修改"基础信息"与"密码"。
 *
 *              业务背景：
 *              用户原话 2026-05-03"需要使用下拉菜单, 增加个人中心, 可供用户编辑用户信息及修改密码"。
 *              触发入口：AppLayout titlebar 的用户名下拉菜单"个人中心"项。
 *
 *              结构：
 *                - 两个 tab：编辑信息 / 修改密码
 *                - 编辑信息：displayName / username 两输入框 → PATCH /api/auth/me
 *                - 修改密码：oldPassword / newPassword / confirmPassword 三输入框
 *                  → POST /api/auth/change-password
 *
 *              交互：
 *                - Escape 关闭（提交中除外）
 *                - 修改密码成功不自动 logout —— 显示成功提示，建议用户主动重登
 *                - 修改基础信息成功后调 loadMe() 让 UserBar 显示新名字
 *
 * @author Atlas.oi
 * @date 2026-05-03
 */

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';

import { useGlobalAuthStore } from '../stores/globalAuthStore';
import { ProgressApiError } from '../../features/progress/api/client';
import { changePassword, updateMyProfile } from '../api/account';
import styles from './ProfileDialog.module.css';

interface ProfileDialogProps {
  onClose: () => void;
}

type Tab = 'profile' | 'password';

/**
 * 个人中心弹窗。
 *
 * 业务流程：
 * 1. 进入时按当前 user 预填 displayName/username
 * 2. 切换 tab 时各 tab 的 form state 独立（避免相互覆盖）
 * 3. 提交期间 disable 关闭/提交按钮 + 拦截 Escape
 * 4. 错误展示在 form 顶部，按 ProgressApiError.message 翻译
 */
export default function ProfileDialog({ onClose }: ProfileDialogProps): ReactElement {
  const user = useGlobalAuthStore((s) => s.user);
  const loadMe = useGlobalAuthStore((s) => s.loadMe);

  const [tab, setTab] = useState<Tab>('profile');

  // ============ 编辑信息 form ============
  // 预填当前 user；user 可能为 null（理论不会，AppLayout 已经挡门）但兜底处理
  const [profileForm, setProfileForm] = useState({
    displayName: user?.displayName ?? '',
    username: user?.username ?? '',
  });
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  // ============ 修改密码 form ============
  const [pwdForm, setPwdForm] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [pwdErrors, setPwdErrors] = useState<Record<string, string>>({});
  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);

  const firstRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, [tab]);

  // Escape 关闭（提交中拦截避免误关）
  const submitting = profileSubmitting || pwdSubmitting;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // ============ profile form 校验 + 提交 ============

  const updateProfile = (k: keyof typeof profileForm) => (e: ChangeEvent<HTMLInputElement>) => {
    setProfileForm({ ...profileForm, [k]: e.target.value });
    if (profileErrors[k]) {
      const next = { ...profileErrors };
      delete next[k];
      setProfileErrors(next);
    }
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);

    // 第一步：本地校验（空白 / 与原值相同时不发请求）
    const errs: Record<string, string> = {};
    const dn = profileForm.displayName.trim();
    const un = profileForm.username.trim();
    if (!dn) errs.displayName = '不能为空';
    if (!un) errs.username = '不能为空';
    if (Object.keys(errs).length > 0) {
      setProfileErrors(errs);
      return;
    }

    // 计算变更字段：原值相同 = 不传（避免无意义 UPDATE 与 username 唯一冲突误报）
    const payload: { displayName?: string; username?: string } = {};
    if (dn !== user?.displayName) payload.displayName = dn;
    if (un !== user?.username) payload.username = un;
    if (Object.keys(payload).length === 0) {
      setProfileSuccess('信息未变化');
      return;
    }

    setProfileSubmitting(true);
    try {
      await updateMyProfile(payload);
      // 重新加载 me 让 UserBar 立即显示新名字（loadMe 会写 globalAuthStore.user）
      await loadMe();
      setProfileSuccess('信息已更新');
    } catch (err) {
      const msg = err instanceof ProgressApiError ? err.message : String(err);
      setProfileError(msg || '更新失败');
    } finally {
      setProfileSubmitting(false);
    }
  };

  // ============ password form 校验 + 提交 ============

  const updatePwd = (k: keyof typeof pwdForm) => (e: ChangeEvent<HTMLInputElement>) => {
    setPwdForm({ ...pwdForm, [k]: e.target.value });
    if (pwdErrors[k]) {
      const next = { ...pwdErrors };
      delete next[k];
      setPwdErrors(next);
    }
  };

  const handlePwdSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(null);

    const errs: Record<string, string> = {};
    if (!pwdForm.oldPassword) errs.oldPassword = '请输入当前密码';
    if (!pwdForm.newPassword) errs.newPassword = '请输入新密码';
    else if (pwdForm.newPassword.length < 8) errs.newPassword = '新密码至少 8 位';
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      errs.confirmPassword = '两次输入的新密码不一致';
    }
    if (pwdForm.oldPassword && pwdForm.oldPassword === pwdForm.newPassword) {
      errs.newPassword = '新密码不能与旧密码相同';
    }
    if (Object.keys(errs).length > 0) {
      setPwdErrors(errs);
      return;
    }

    setPwdSubmitting(true);
    try {
      await changePassword({
        oldPassword: pwdForm.oldPassword,
        newPassword: pwdForm.newPassword,
      });
      // 用户原话 2026-05-03"修改密码后让用户手动重登" —— 不自动 logout
      setPwdSuccess('密码已修改，建议重新登录以同步其它会话状态');
      setPwdForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      const msg = err instanceof ProgressApiError ? err.message : String(err);
      setPwdError(msg || '密码修改失败');
    } finally {
      setPwdSubmitting(false);
    }
  };

  // ============ 渲染 ============
  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="个人中心"
      data-testid="profile-dialog-overlay"
      onClick={(e) => {
        // 点遮罩关闭（提交中拦截）
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.head}>
          <h3>个人中心</h3>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            disabled={submitting}
            aria-label="关闭"
            data-testid="profile-dialog-close"
          >
            ×
          </button>
        </div>

        {/* tabs */}
        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'profile'}
            className={`${styles.tab} ${tab === 'profile' ? styles.tabActive : ''}`}
            onClick={() => setTab('profile')}
            data-testid="profile-dialog-tab-profile"
          >
            编辑信息
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'password'}
            className={`${styles.tab} ${tab === 'password' ? styles.tabActive : ''}`}
            onClick={() => setTab('password')}
            data-testid="profile-dialog-tab-password"
          >
            修改密码
          </button>
        </div>

        {tab === 'profile' && (
          <form onSubmit={handleProfileSubmit} data-testid="profile-form">
            <div className={styles.body}>
              {profileError && (
                <div className={styles.submitError} role="alert">
                  {profileError}
                </div>
              )}
              {profileSuccess && (
                <div className={styles.submitOk} role="status">
                  {profileSuccess}
                </div>
              )}

              <div className={styles.field}>
                <label htmlFor="profile-displayName">显示名称</label>
                <input
                  id="profile-displayName"
                  ref={tab === 'profile' ? firstRef : undefined}
                  type="text"
                  value={profileForm.displayName}
                  onChange={updateProfile('displayName')}
                  autoComplete="name"
                  data-testid="profile-input-displayName"
                />
                {profileErrors.displayName && (
                  <div className={styles.fieldError}>{profileErrors.displayName}</div>
                )}
                <div className={styles.fieldHint}>用于在标题栏与时间线中展示</div>
              </div>

              <div className={styles.field}>
                <label htmlFor="profile-username">登录账号</label>
                <input
                  id="profile-username"
                  type="text"
                  value={profileForm.username}
                  onChange={updateProfile('username')}
                  autoComplete="username"
                  data-testid="profile-input-username"
                />
                {profileErrors.username && (
                  <div className={styles.fieldError}>{profileErrors.username}</div>
                )}
                <div className={styles.fieldHint}>修改后下次登录请使用新账号</div>
              </div>
            </div>

            <div className={styles.foot}>
              <button
                type="button"
                className={styles.btn}
                onClick={onClose}
                disabled={submitting}
              >
                关闭
              </button>
              <button
                type="submit"
                className={styles.btnPrimary}
                disabled={profileSubmitting}
                data-testid="profile-submit"
              >
                {profileSubmitting ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        )}

        {tab === 'password' && (
          <form onSubmit={handlePwdSubmit} data-testid="password-form">
            <div className={styles.body}>
              {pwdError && (
                <div className={styles.submitError} role="alert">
                  {pwdError}
                </div>
              )}
              {pwdSuccess && (
                <div className={styles.submitOk} role="status">
                  {pwdSuccess}
                </div>
              )}

              <div className={styles.field}>
                <label htmlFor="pwd-old">当前密码</label>
                <input
                  id="pwd-old"
                  ref={tab === 'password' ? firstRef : undefined}
                  type="password"
                  value={pwdForm.oldPassword}
                  onChange={updatePwd('oldPassword')}
                  autoComplete="current-password"
                  data-testid="password-input-old"
                />
                {pwdErrors.oldPassword && (
                  <div className={styles.fieldError}>{pwdErrors.oldPassword}</div>
                )}
              </div>

              <div className={styles.field}>
                <label htmlFor="pwd-new">新密码</label>
                <input
                  id="pwd-new"
                  type="password"
                  value={pwdForm.newPassword}
                  onChange={updatePwd('newPassword')}
                  autoComplete="new-password"
                  data-testid="password-input-new"
                />
                {pwdErrors.newPassword && (
                  <div className={styles.fieldError}>{pwdErrors.newPassword}</div>
                )}
                <div className={styles.fieldHint}>至少 8 位</div>
              </div>

              <div className={styles.field}>
                <label htmlFor="pwd-confirm">再次输入新密码</label>
                <input
                  id="pwd-confirm"
                  type="password"
                  value={pwdForm.confirmPassword}
                  onChange={updatePwd('confirmPassword')}
                  autoComplete="new-password"
                  data-testid="password-input-confirm"
                />
                {pwdErrors.confirmPassword && (
                  <div className={styles.fieldError}>{pwdErrors.confirmPassword}</div>
                )}
              </div>
            </div>

            <div className={styles.foot}>
              <button
                type="button"
                className={styles.btn}
                onClick={onClose}
                disabled={submitting}
              >
                关闭
              </button>
              <button
                type="submit"
                className={styles.btnPrimary}
                disabled={pwdSubmitting}
                data-testid="password-submit"
              >
                {pwdSubmitting ? '提交中…' : '修改密码'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
