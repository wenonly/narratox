/*
 * Auth Window —— 440×780 浮动窗的切换逻辑 + titlebar 窗控。
 * 不接 server、不验证输入;点击登录/注册按钮什么都不做。
 * 切换 login ↔ register 通过 data-switch 属性。
 * 窗控(最小化/最大化/关闭)走 narratox bridge → main 进程。
 */

type AuthMode = 'login' | 'register';

let loginForm: HTMLElement | null = null;
let registerForm: HTMLElement | null = null;

export function initAuth(): void {
  loginForm = document.querySelector<HTMLElement>('[data-form="login"]');
  registerForm = document.querySelector<HTMLElement>('[data-form="register"]');

  if (!loginForm || !registerForm) {
    console.warn('[auth] 缺少必要 DOM 节点,初始化中止');
    return;
  }

  // 平台标识:CSS 据此切换 Mac/Win titlebar 形态(Mac 走 native traffic lights)。
  const platform = window.narratox?.platform ?? '';
  document.getElementById('authWindow')?.setAttribute('data-platform', platform);

  // 切换链接
  document.querySelectorAll<HTMLButtonElement>('[data-switch]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const mode = btn.dataset.switch as AuthMode;
      if (mode) switchMode(mode);
    });
  });

  // 阻止 form 默认提交(纯样式阶段不接 server)
  document.querySelectorAll<HTMLFormElement>('form').forEach((form) => {
    form.addEventListener('submit', (e) => e.preventDefault());
  });

  // Titlebar 窗控
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action as 'minimize' | 'maximize' | 'close';
      window.narratox?.windowAction?.(action);
    });
  });
}

function switchMode(mode: AuthMode): void {
  if (!loginForm || !registerForm) return;
  const showLogin = mode === 'login';
  loginForm.hidden = !showLogin;
  registerForm.hidden = showLogin;
}
