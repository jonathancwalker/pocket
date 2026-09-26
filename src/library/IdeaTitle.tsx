import { useLayoutEffect, useRef } from 'react';

export default function IdeaTitle({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const node = field.current;
    if (!node) return;
    node.style.height = '0px';
    node.style.height = `${node.scrollHeight}px`;
  };
  useLayoutEffect(resize, [value]);
  useLayoutEffect(() => {
    const node = field.current;
    if (!node) return;
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      resize();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <textarea
      ref={field}
      className="idea-title"
      aria-label="Idea title"
      placeholder="Untitled"
      rows={1}
      maxLength={1000}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing)
          e.preventDefault();
      }}
    />
  );
}
