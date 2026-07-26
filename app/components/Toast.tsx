"use client";

interface ToastProps {
  message: string | null;
}

export default function Toast({ message }: ToastProps) {
  if (!message) return null;
  return (
    <div className="toast" role="alert">
      {message}
    </div>
  );
}
