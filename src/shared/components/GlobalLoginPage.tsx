/**
 * @file GlobalLoginPage.tsx
 * @description 全局登录页（AppLayout 顶层未登录时渲染）—— 1:1 复刻 designs/habitat-grid-login.html。
 *
 *              业务定位：
 *                - 应用级前置门：替代原 progress 模块的 LoginPage
 *                - 收集 username + password，调 globalAuthStore.login
 *                - 失败回显 store.error；成功后由 AppLayout 自动切到主界面
 *
 *              视觉契约：见 GlobalLoginPage.module.css。
 *              动画：右侧 Pretext 文本场 + ghost icon 浮动位移；
 *                    pretext 通过 esm.sh 动态加载（设计稿原方案），加载失败 fallback
 *                    到几何分行（不影响登录功能）。
 *
 *              Token 注：本页采用设计稿原 #0d0d0c 暗岩苔基线（限定在 .loginRoot 作用域，
 *              不污染 progress 模块的 OKLCH 森青）。
 *
 * @author Atlas.oi
 * @date 2026-04-30
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useGlobalAuthStore } from '../stores/globalAuthStore';
import styles from './GlobalLoginPage.module.css';

// ============================================
// Pretext 动画：transcript / 关键字 / 几何 fallback 常量
// ============================================

const TRANSCRIPT_LINES = [
  '$ ghostterm open ./workspace',
  'detecting shell profile ... zsh ready',
  'mounting terminal session over local bridge',
  'indexing recent files without exposing project data',
  'pretext measures this output and returns stable line breaks',
  'the ghost cursor moves through the text and asks layout to make room',
  'wake: command stream bends, glows, then settles back',
  'status: waiting for login',
  '$ _',
];
const TRANSCRIPT = TRANSCRIPT_LINES.join('  ');
const KEYWORDS = ['shell', 'bridge', 'pretext', 'layout', 'wake', 'login'];

/**
 * 几何 fallback：在 pretext 加载失败时按近似字符宽度切行。
 * 与设计稿 makeFallbackLines 等价。
 */
function makeFallbackLines(text: string, width: number): string[] {
  const approxChars = Math.max(24, Math.floor(width / 8.2));
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > approxChars) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** 动态加载 pretext（esm.sh CDN 方案，失败返回 null）
 *
 *  设计稿原方案：从 esm.sh 远程加载 @chenglou/pretext。
 *  TS 不识别 URL import 模块路径，用 ts-ignore；vite/浏览器在运行时正常解析。
 */
async function loadPretext(): Promise<{ prepare?: unknown; layout?: unknown } | null> {
  try {
    // @ts-expect-error URL import is not typed; resolved at runtime by the browser.
    const mod = await import(/* @vite-ignore */ 'https://esm.sh/@chenglou/pretext');
    return mod as { prepare?: unknown; layout?: unknown };
  } catch {
    return null;
  }
}

export default function GlobalLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);

  const login = useGlobalAuthStore((s) => s.login);
  const loading = useGlobalAuthStore((s) => s.loading);
  const error = useGlobalAuthStore((s) => s.error);

  // ============================================
  // Pretext 动画 refs
  // ============================================
  const fieldRef = useRef<HTMLDivElement>(null);
  const linesLayerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      await login(username, password);
    } catch {
      // 错误已写入 store.error；这里仅吞掉以避免 unhandled rejection
    }
  };

  // ============================================
  // 启动 Pretext 文本场动画 + ghost 浮动
  //
  // 业务流程：
  //   1. 加载 pretext（esm.sh）；失败 fallback 几何分行
  //   2. 渲染 N 条 wake-line（DOM 节点）到 linesLayer
  //   3. RAF tick：ghost sin/cos 位移 + 每条 line 按距离做 wake 偏移
  //   4. 每 ~1.7s 飘出一个 keyword chip
  //
  // jsdom 兼容：getBoundingClientRect 返回 0 时 setup 静默退出，不崩。
  // ============================================
  useEffect(() => {
    let rafId = 0;
    let cancelled = false;
    const lineEls: HTMLSpanElement[] = [];

    const start = async () => {
      const field = fieldRef.current;
      const linesLayer = linesLayerRef.current;
      const ghost = ghostRef.current;
      if (!field || !linesLayer || !ghost) return;

      const rect = field.getBoundingClientRect();
      // jsdom / 0 尺寸：跳过避免崩
      if (rect.width === 0 || rect.height === 0) return;

      const pretext = await loadPretext();
      if (cancelled) return;

      // 优先用 pretext layout；失败用几何 fallback
      const fallbackLines = makeFallbackLines(TRANSCRIPT, rect.width * 0.74);
      // pretext 0.0.6 API 入参/返回结构未公开稳定；这里仅在能调用时使用，否则 fallback
      let lineTexts: string[] = fallbackLines;
      try {
        const prepareFn = (pretext as { prepare?: unknown } | null)?.prepare as
          | ((t: string, f: string) => unknown)
          | undefined;
        const layoutFn = (pretext as { layout?: unknown } | null)?.layout as
          | ((p: unknown, w: number, lh: number) => { lines?: { text?: string }[] } | null)
          | undefined;
        if (prepareFn && layoutFn) {
          const prepared = prepareFn(TRANSCRIPT, '13px SFMono-Regular');
          const laid = layoutFn(prepared, rect.width * 0.74, 20);
          const collected = laid?.lines?.map((l) => l.text ?? '').filter(Boolean) ?? [];
          if (collected.length > 0) lineTexts = collected;
        }
      } catch {
        // pretext 调用失败保持 fallback
      }

      const count = Math.min(18, lineTexts.length);
      linesLayer.replaceChildren();
      for (let i = 0; i < count; i++) {
        const span = document.createElement('span');
        span.className = styles.wakeLine!;
        span.textContent = lineTexts[i % lineTexts.length] ?? '';
        span.style.setProperty('--line-y', `${i * 27}px`);
        linesLayer.appendChild(span);
        lineEls.push(span);
      }

      let lastKeyword = -1;
      const tick = (time: number) => {
        if (cancelled) return;
        const r = field.getBoundingClientRect();
        const ghostX = r.width * (0.5 + Math.sin(time * 0.00045) * 0.28);
        const ghostY = r.height * (0.48 + Math.cos(time * 0.00062) * 0.22);
        ghost.style.transform =
          `translate(${ghostX - 58}px, ${ghostY - 58}px) rotate(${Math.sin(time * 0.001) * 5}deg)`;

        for (let i = 0; i < lineEls.length; i++) {
          const line = lineEls[i]!;
          const y = 24 + i * 27;
          const distance = Math.abs(y - ghostY);
          const influence = Math.max(0, 1 - distance / 118);
          const side = ghostX > r.width / 2 ? -1 : 1;
          const wakeOffset = influence * 92 * side;
          const wakeWidth = r.width * 0.72 - influence * 170;
          line.style.setProperty('--line-x', `${24 + wakeOffset}px`);
          line.style.setProperty('--line-y', `${y}px`);
          line.style.setProperty('--line-width', `${Math.max(260, wakeWidth)}px`);
          if (influence > 0.62) line.classList.add(styles.wakeLineActive!);
          else line.classList.remove(styles.wakeLineActive!);
        }

        // keyword chip：每个 keyword 周期飘一次
        const keywordIndex = Math.floor(time / 1700) % KEYWORDS.length;
        if (keywordIndex !== lastKeyword) {
          lastKeyword = keywordIndex;
          const chip = document.createElement('span');
          chip.className = styles.wakeChip!;
          chip.textContent = `:${KEYWORDS[keywordIndex]}`;
          chip.style.left = `${ghostX + 52}px`;
          chip.style.top = `${ghostY - 18}px`;
          field.appendChild(chip);
          window.setTimeout(() => chip.remove(), 920);
        }

        rafId = requestAnimationFrame(tick);
      };

      rafId = requestAnimationFrame(tick);
    };

    void start();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      // 清空 lines DOM（避免 unmount 残留 chip）
      linesLayerRef.current?.replaceChildren();
    };
  }, []);

  return (
    <div data-testid="global-login-page" className={styles.loginRoot}>
      <main className={styles.stage}>
        <section className={styles.loginShell}>
          {/* ============================================
              左：Identity deck（品牌带 + 表单）
              ============================================ */}
          <section className={styles.identityDeck} aria-label="登录身份舱">
            <header className={styles.brandStrip}>
              <div className={styles.brand}>
                <div className={styles.brandMark}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12.5 12 4l7 8.5-7 7.5-7-7.5Z" />
                    <path d="M8.5 12.2h7" />
                    <path d="M12 8.5v7.4" />
                  </svg>
                </div>
                <div>
                  <strong>GhostTerm</strong>
                  <span>Habitat Grid Identity Gate</span>
                </div>
              </div>
              <div className={styles.capsule}>本地安全会话</div>
            </header>

            <div className={styles.loginPanel}>
              <div className={styles.eyebrow}>Workspace Access</div>
              <h1 className={styles.headline}>进入你的项目栖息地</h1>

              <form className={styles.form} onSubmit={onSubmit} data-testid="global-login-form">
                <div className={styles.field}>
                  <label htmlFor="global-login-username-input">账号</label>
                  <div className={styles.inputShell}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20 21a8 8 0 0 0-16 0" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    <input
                      id="global-login-username-input"
                      type="text"
                      required
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      data-testid="global-login-username"
                    />
                    <span className={styles.domainTag}>OWNER</span>
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor="global-login-password-input">密码</label>
                  <div className={styles.inputShell}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="4" y="10" width="16" height="10" rx="2" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>
                    <input
                      id="global-login-password-input"
                      type="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      data-testid="global-login-password"
                    />
                    <span className={styles.domainTag}>加密</span>
                  </div>
                </div>

                <div className={styles.formTools}>
                  <label className={styles.check} data-testid="global-login-remember">
                    <span
                      className={`${styles.checkBox} ${remember ? styles.checkBoxOn : ''}`}
                      onClick={() => setRemember((v) => !v)}
                      role="checkbox"
                      aria-checked={remember}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault();
                          setRemember((v) => !v);
                        }
                      }}
                    />
                    保持本机登录
                  </label>
                  <button
                    type="button"
                    className={styles.textLink}
                    data-testid="global-login-reset"
                    onClick={() => {
                      // 视觉占位：当前 store 无重置流程，未来由超管后台分发新口令
                    }}
                  >
                    重置访问密钥
                  </button>
                </div>

                {error ? (
                  <div data-testid="global-login-error" className={styles.errorBanner}>
                    {error}
                  </div>
                ) : null}

                <div className={styles.actions}>
                  <button
                    className={styles.primary}
                    type="submit"
                    disabled={loading}
                    data-testid="global-login-submit"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12h13" />
                      <path d="m13 6 6 6-6 6" />
                    </svg>
                    {loading ? '登录中…' : '进入工作区'}
                  </button>
                </div>
              </form>
            </div>
          </section>

          {/* ============================================
              右：Signal board（Pretext 文本场 + ghost 动画）
              ============================================ */}
          <section className={`${styles.signalBoard} ${styles.pretextStage}`} aria-label="Pretext Ghost 入口视觉">

            {/* <div className={styles.pretextStage}> */}
              <div className={styles.wakeHead}>
                <div>
                  <div className={styles.wakeTitle}>Command Wake</div>
                </div>
                <div className={styles.wakeMeter}>
                  <span />
                </div>
              </div>

              <div className={styles.wakeField} ref={fieldRef}>
                <div className={styles.wakeLines} ref={linesLayerRef} />
                <div className={styles.wakeGhost} ref={ghostRef}>
                  <img src="/ghost-mark.png" alt="GhostTerm" />
                </div>
              </div>
            {/* </div> */}
          </section>
        </section>
      </main>
    </div>
  );
}
