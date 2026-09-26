import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Italic, List, ListOrdered, Quote, Link2, Undo2, Redo2, X } from 'lucide-react';
import type { JsonNode } from '../types';
import { parseLink, errorText } from '../domain';
import { api } from '../bridge';
import IconButton from '../components/IconButton';

export default function WritingEditor({
  id,
  body,
  onChange,
}: {
  id: string;
  body: JsonNode;
  onChange: (body: JsonNode) => void;
}) {
  const change = useRef(onChange);
  change.current = onChange;
  const [linkMode, setLinkMode] = useState(false),
    [url, setUrl] = useState(''),
    [error, setError] = useState('');
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          code: false,
          codeBlock: false,
          strike: false,
          underline: false,
          horizontalRule: false,
          link: {
            openOnClick: false,
            autolink: false,
            defaultProtocol: 'https',
            protocols: ['http', 'https'],
          },
        }),
        Placeholder.configure({ placeholder: 'Write…' }),
      ],
      content: body,
      parseOptions: { preserveWhitespace: 'full' },
      editorProps: {
        attributes: {
          class: 'writing-surface',
          'aria-label': 'Expand your idea',
          role: 'textbox',
          'aria-multiline': 'true',
          spellcheck: 'true',
        },
        handleClick: (_view, _position, event) => {
          const anchor = (event.target as HTMLElement).closest('a');
          if (anchor && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void api.openLink(anchor.href).catch((e) => setError(errorText(e)));
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => change.current(editor.getJSON() as JsonNode),
    },
    [id],
  );
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive('bold'),
      italic: editor?.isActive('italic'),
      bullet: editor?.isActive('bulletList'),
      ordered: editor?.isActive('orderedList'),
      quote: editor?.isActive('blockquote'),
      link: editor?.isActive('link'),
      heading: editor?.isActive('heading') ? String(editor.getAttributes('heading').level) : '0',
    }),
  });
  useEffect(() => {
    setLinkMode(false);
    setError('');
  }, [id]);
  if (!editor) return null;
  function applyLink() {
    if (!editor) return;
    try {
      if (!url.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run();
      else
        editor
          .chain()
          .focus()
          .extendMarkRange('link')
          .setLink({ href: parseLink(url).url })
          .run();
      setLinkMode(false);
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <div className="writing-editor">
      <div
        className="editor-toolbar"
        role="toolbar"
        aria-label="Text formatting"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) e.preventDefault();
        }}
      >
        <select
          aria-label="Paragraph style"
          value={active?.heading ?? '0'}
          onChange={(e) => {
            const level = Number(e.target.value);
            if (level)
              editor
                .chain()
                .focus()
                .toggleHeading({ level: level as 1 | 2 | 3 })
                .run();
            else editor.chain().focus().setParagraph().run();
          }}
        >
          <option value="0">Text</option>
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
        </select>
        <span className="toolbar-divider" />
        <IconButton
          label="Bold · ⌘B"
          aria-pressed={active?.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={16} />
        </IconButton>
        <IconButton
          label="Italic · ⌘I"
          aria-pressed={active?.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={16} />
        </IconButton>
        <span className="toolbar-divider" />
        <IconButton
          label="Bullet list"
          aria-pressed={active?.bullet}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={17} />
        </IconButton>
        <IconButton
          label="Numbered list"
          aria-pressed={active?.ordered}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={17} />
        </IconButton>
        <IconButton
          label="Quote"
          aria-pressed={active?.quote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote size={16} />
        </IconButton>
        <IconButton
          label="Add or edit text link"
          aria-pressed={active?.link}
          onClick={() => {
            setUrl(editor.getAttributes('link').href || '');
            setLinkMode((v) => !v);
            setError('');
          }}
        >
          <Link2 size={16} />
        </IconButton>
        <span className="toolbar-spacer" />
        <IconButton label="Undo · ⌘Z" onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton label="Redo · ⌘⇧Z" onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 size={16} />
        </IconButton>
      </div>
      {linkMode && (
        <div className="editor-link-form">
          <input
            aria-label="Text link URL"
            autoFocus
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              }
              if (e.key === 'Escape') {
                setLinkMode(false);
                editor.commands.focus();
              }
            }}
          />
          <button className="small-button" onClick={applyLink}>
            {url.trim() ? 'Apply' : 'Remove link'}
          </button>
          <IconButton label="Cancel link" onClick={() => setLinkMode(false)}>
            <X size={15} />
          </IconButton>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
