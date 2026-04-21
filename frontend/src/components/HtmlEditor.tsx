'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Strikethrough } from 'lucide-react';

interface HtmlEditorProps {
  value: string;
  onChange: (html: string) => void;
  onBlurSave?: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  className?: string;
}

export function HtmlEditor({
  value,
  onChange,
  onBlurSave,
  placeholder = 'Yazın…',
  minHeight = '90px',
  className = '',
}: HtmlEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  // Track whether internal input caused the value update to avoid cursor reset
  const isInternalUpdate = useRef(false);

  // Only sync external value changes (e.g. on initial load or external reset)
  useEffect(() => {
    if (!editorRef.current) return;
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    // Avoid resetting when innerHTML already matches (prevents cursor jump)
    if (editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value ?? '';
    }
  }, [value]);

  const handleInput = useCallback(() => {
    isInternalUpdate.current = true;
    onChange(editorRef.current?.innerHTML ?? '');
  }, [onChange]);

  const handleBlur = useCallback(() => {
    if (onBlurSave) {
      onBlurSave(editorRef.current?.innerHTML ?? '');
    }
  }, [onBlurSave]);

  const exec = (cmd: string, val?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val ?? undefined);
    isInternalUpdate.current = true;
    onChange(editorRef.current?.innerHTML ?? '');
  };

  const toolbarBtn = (
    onClick: () => void,
    icon: React.ReactNode,
    title: string,
  ) => (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault(); // prevent editor losing focus
        onClick();
      }}
      title={title}
      className="p-1.5 rounded hover:bg-gray-200 text-gray-600 hover:text-gray-900 transition-colors"
    >
      {icon}
    </button>
  );

  return (
    <div className={`border border-gray-200 rounded-lg overflow-hidden ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1 bg-gray-50 border-b border-gray-200">
        {toolbarBtn(() => exec('bold'), <Bold className="w-3.5 h-3.5" />, 'Kalın (Bold)')}
        {toolbarBtn(() => exec('italic'), <Italic className="w-3.5 h-3.5" />, 'İtalik')}
        {toolbarBtn(() => exec('underline'), <Underline className="w-3.5 h-3.5" />, 'Altı Çizili')}
        {toolbarBtn(() => exec('strikeThrough'), <Strikethrough className="w-3.5 h-3.5" />, 'Üstü Çizili')}
        <div className="w-px h-4 bg-gray-300 mx-1" />
        {toolbarBtn(
          () => exec('insertUnorderedList'),
          <List className="w-3.5 h-3.5" />,
          'Madde İşaretli Liste',
        )}
        {toolbarBtn(
          () => exec('insertOrderedList'),
          <ListOrdered className="w-3.5 h-3.5" />,
          'Numaralı Liste',
        )}
        <div className="w-px h-4 bg-gray-300 mx-1" />
        {toolbarBtn(() => exec('removeFormat'), (
          <span className="text-[11px] font-medium leading-none">Tx</span>
        ), 'Biçimi Temizle')}
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={handleBlur}
        data-placeholder={placeholder}
        style={{ minHeight }}
        className={[
          'px-3 py-2.5 text-sm focus:outline-none',
          '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
          '[&_b]:font-semibold [&_strong]:font-semibold [&_i]:italic [&_em]:italic',
          '[&_u]:underline [&_s]:line-through',
          '[&_li]:my-0.5 [&_p]:my-1',
          'empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400 empty:before:pointer-events-none',
        ].join(' ')}
      />
    </div>
  );
}
