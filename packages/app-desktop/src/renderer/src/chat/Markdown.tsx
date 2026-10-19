import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  text: string;
};

// No rehype-raw — deliberately never renders raw HTML from message content
// (user text, attached file content, or model output all flow through
// this). Links open in the OS browser via main's setWindowOpenHandler,
// never navigate the app window itself.
export function Markdown({ text }: Props) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
