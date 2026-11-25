import {
  Bell,
  BellOff,
  KeyRound,
  Keyboard,
  LogIn,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Settings,
  Sun,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { UserAccount, UserRole } from '../types/exam';

interface SettingsModalProps {
  role: UserRole;
  currentUser: UserAccount | null;
  isDark: boolean;
  onToggleTheme: () => void;
  rightSidebarCollapsed: boolean;
  onToggleRightSidebar: () => void;
  alertSoundEnabled: boolean;
  onToggleAlertSound: () => void;
  onOpenAuth: (mode?: 'login' | 'register') => void;
  onOpenProfile: (tab?: 'view_edit' | 'password') => void;
  onOpenAccountManager: (tab: 'create' | 'list') => void;
  onOpenShortcuts: () => void;
  onResetDemoData: () => void;
  onClose: () => void;
}

export function SettingsModal({
  role,
  currentUser,
  isDark,
  onToggleTheme,
  rightSidebarCollapsed,
  onToggleRightSidebar,
  alertSoundEnabled,
  onToggleAlertSound,
  onOpenAuth,
  onOpenProfile,
  onOpenAccountManager,
  onOpenShortcuts,
  onResetDemoData,
  onClose,
}: SettingsModalProps) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const isStaff = role === 'teacher' || role === 'admin';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs dark:bg-slate-950/80"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Settings className="h-5 w-5 text-blue-700 dark:text-blue-400" />
            <h2
              id="settings-modal-title"
              className="font-display text-base font-bold text-slate-900 sm:text-lg dark:text-slate-50"
            >
              Cài đặt hệ thống
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cài đặt"
            className="cursor-pointer rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 p-6">
          {/* Appearance & Layout */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              Giao diện & Hiển thị
            </h3>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex items-center gap-3">
                  {isDark ? (
                    <Moon className="h-4 w-4 shrink-0 text-blue-400" />
                  ) : (
                    <Sun className="h-4 w-4 shrink-0 text-amber-500" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      Chế độ giao diện
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {isDark ? 'Đang dùng giao diện tối' : 'Đang dùng giao diện sáng'} · Phím tắt D
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isDark}
                  onClick={onToggleTheme}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                    isDark ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                      isDark ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex items-center gap-3">
                  {rightSidebarCollapsed ? (
                    <PanelRightOpen className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                  ) : (
                    <PanelRightClose className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      Thu gọn thanh menu bên phải
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {rightSidebarCollapsed ? 'Đang thu gọn thành biểu tượng' : 'Đang hiển thị đầy đủ'} · Phím tắt M
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={rightSidebarCollapsed}
                  onClick={onToggleRightSidebar}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                    rightSidebarCollapsed ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                      rightSidebarCollapsed ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </section>

          {/* Notifications & Sound (Staff) */}
          {isStaff && (
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                Thông báo & Giám sát
              </h3>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="flex items-center gap-3">
                    {alertSoundEnabled ? (
                      <Bell className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <BellOff className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                        Âm thanh cảnh báo trực tiếp
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Phát âm báo khi có vi phạm hoặc yêu cầu tham gia lớp mới
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={alertSoundEnabled}
                    onClick={onToggleAlertSound}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                      alertSoundEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                        alertSoundEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Account & Access */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              Tài khoản
            </h3>
            {currentUser ? (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenProfile('view_edit');
                  }}
                  className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <span className="flex items-center gap-3">
                    <UserCheck className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                    <span>
                      <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                        Thông tin cá nhân
                      </span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {currentUser.fullName} · ID: {currentUser.id}
                      </span>
                    </span>
                  </span>
                  <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                    Chỉnh sửa
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenProfile('password');
                  }}
                  className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <span className="flex items-center gap-3">
                    <KeyRound className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      Đổi mật khẩu
                    </span>
                  </span>
                  <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                    Cập nhật
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAccountManager('list');
                  }}
                  className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <span className="flex items-center gap-3">
                    <Users className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      Quản lý & chuyển tài khoản
                    </span>
                  </span>
                  <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                    Mở
                  </span>
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-600 dark:text-slate-300">
                    Bạn đang ở chế độ xem thử.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAuth('login');
                    }}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    <span>Đăng nhập</span>
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* System & Support */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              Hệ thống & Hỗ trợ
            </h3>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenShortcuts();
                }}
                className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <span className="flex items-center gap-3">
                  <Keyboard className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    Bảng phím tắt hệ thống
                  </span>
                </span>
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  ?
                </kbd>
              </button>

              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <RotateCcw className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      Khôi phục dữ liệu mẫu
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {resetDone
                        ? 'Đã khôi phục toàn bộ dữ liệu mẫu thành công.'
                        : 'Đưa đề thi, lớp học và kết quả về trạng thái ban đầu'}
                    </p>
                  </div>
                </div>
                {confirmReset ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onResetDemoData();
                        setConfirmReset(false);
                        setResetDone(true);
                        setTimeout(() => setResetDone(false), 3000);
                      }}
                      className="cursor-pointer rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-red-700"
                    >
                      Xác nhận
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmReset(false)}
                      className="cursor-pointer rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Hủy
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmReset(true)}
                    className="cursor-pointer rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Khôi phục
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-slate-200 px-6 py-3.5 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            Đóng (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
