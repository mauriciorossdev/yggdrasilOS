import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_strings.dart';
import '../theme/ygg_theme.dart';

/// Base prose style — the exact values chat_screen.dart's raw RichText/
/// TextSpan already used before markdown rendering existed
/// (markdown-render-ux.md §0/§4). Bold/italic/headers/etc. below are all
/// defined relative to this.
const kAssistantProseStyle = TextStyle(fontWeight: FontWeight.w300, fontSize: 15.5, height: 1.6, color: YggColors.text);

/// Renders a (possibly partial, mid-stream) markdown string with the styles
/// from markdown-render-ux.md. Used for both the "safe prefix" while
/// streaming and the final complete assistant message
/// (markdown-streaming-render-design.md §1/§2).
class AssistantMarkdown extends StatelessWidget {
  final String data;

  const AssistantMarkdown({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    return MarkdownBody(
      data: data,
      selectable: false,
      styleSheet: _styleSheet,
      builders: {'pre': _CodeBlockBuilder(), 'code': _InlineCodeBuilder()},
      onTapLink: (text, href, title) => _openLink(href),
    );
  }
}

Future<void> _openLink(String? href) async {
  if (href == null || href.isEmpty) return;
  // markdown-render-ux.md §4 — a direct tap on already-shown content by the
  // user, not a model tool call: no approval gate applies. No scheme
  // validation either — let the OS decide whether something handles it
  // (mailto:, tel:, an unknown custom scheme).
  final uri = Uri.tryParse(href);
  if (uri == null) return;
  try {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {
    // Best-effort — nothing to recover into if there's no handler.
  }
}

final MarkdownStyleSheet _styleSheet = MarkdownStyleSheet(
  p: kAssistantProseStyle,
  pPadding: EdgeInsets.zero,
  // §4: w600, not bold/w700 — the base weight is already light (w300), w700
  // would read as too heavy next to it.
  strong: const TextStyle(fontWeight: FontWeight.w600),
  // §4: italic only, no color/opacity change — italics already reads as
  // emphasis on its own.
  em: const TextStyle(fontStyle: FontStyle.italic),
  a: const TextStyle(color: YggColors.accent, decoration: TextDecoration.underline),
  h1: const TextStyle(fontWeight: FontWeight.w600, fontSize: 20, color: YggColors.text),
  h1Padding: const EdgeInsets.only(top: 12, bottom: 6),
  h2: const TextStyle(fontWeight: FontWeight.w600, fontSize: 18, color: YggColors.text),
  h2Padding: const EdgeInsets.only(top: 12, bottom: 6),
  h3: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16.5, color: YggColors.text),
  h3Padding: const EdgeInsets.only(top: 12, bottom: 6),
  // Listed for completeness (MarkdownStyleSheet.fromTheme's default is used
  // as the base via merge()) — the actual code-span look comes from
  // _InlineCodeBuilder below, which the 'code' builder entry overrides this
  // with for every real inline code span.
  code: const TextStyle(fontFamily: 'monospace', fontSize: 15.5, color: YggColors.text),
  // §4: list marker in accent, same size/line-height as the paragraph so a
  // list doesn't feel "tighter" than surrounding prose.
  listBullet: const TextStyle(color: YggColors.accent, fontSize: 15.5, height: 1.6),
  listIndent: 22,
  listBulletPadding: const EdgeInsets.only(right: 6),
  blockSpacing: 10,
  // §2 — table: hairline border with rounded corners around the whole
  // table (no separate container needed, TableBorder.all supports
  // borderRadius directly), header fill cardFillHigh + bold, body left
  // transparent (shows bg through, same as the rest of the message).
  tableHead: const TextStyle(fontWeight: FontWeight.w600, color: YggColors.text, fontSize: 14),
  tableBody: const TextStyle(color: YggColors.text, fontSize: 14),
  tableHeadAlign: TextAlign.left,
  tableCellsPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
  tableHeadCellsDecoration: const BoxDecoration(color: YggColors.cardFillHigh),
  tableBorder: TableBorder.all(color: YggColors.hairline, width: 1, borderRadius: BorderRadius.circular(12)),
  // Not in either doc's priority list (UX §1 explicitly leaves blockquotes
  // out of scope) — minimal treatment only, per UX §1's own suggestion.
  blockquote: const TextStyle(color: YggColors.textMuted, fontStyle: FontStyle.italic, fontSize: 15.5, height: 1.6),
  blockquotePadding: const EdgeInsets.only(left: 12),
  blockquoteDecoration: const BoxDecoration(
    border: Border(left: BorderSide(color: YggColors.accent, width: 3)),
  ),
);

// §3 — inline code span: no container/badge, just a small rounded chip
// behind monospace text at the surrounding paragraph's own font size.
class _InlineCodeBuilder extends MarkdownElementBuilder {
  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      decoration: BoxDecoration(color: YggColors.cardFillHigh, borderRadius: BorderRadius.circular(4)),
      child: Text(
        element.textContent,
        style: const TextStyle(fontFamily: 'monospace', fontSize: 15.5, color: YggColors.text),
      ),
    );
  }
}

// §3 — fenced code block: own container (fill cardFillHighest, radius 10),
// language badge reusing the risk-badge's exact visual treatment when the
// fence has an info-string, horizontal scroll (never wrap), copy button
// per block.
class _CodeBlockBuilder extends MarkdownElementBuilder {
  @override
  bool isBlockElement() => true;

  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) {
    // package:markdown always shapes a code block as Element('pre',
    // [Element.text('code', content)]) — see fenced_code_block_syntax.dart /
    // code_block_syntax.dart — so the info-string language (when present)
    // lives on that single <code> child's class="language-xxx" attribute.
    md.Element? codeElement;
    for (final child in element.children ?? const <md.Node>[]) {
      if (child is md.Element) {
        codeElement = child;
        break;
      }
    }
    var code = element.textContent;
    if (code.endsWith('\n')) code = code.substring(0, code.length - 1);
    String? language;
    final cls = codeElement?.attributes['class'];
    if (cls != null && cls.startsWith('language-')) {
      language = cls.substring('language-'.length);
    }
    return _CodeBlock(code: code, language: language);
  }
}

class _CodeBlock extends StatelessWidget {
  final String code;
  final String? language;

  const _CodeBlock({required this.code, this.language});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(color: YggColors.cardFillHighest, borderRadius: BorderRadius.circular(10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (language != null && language!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
              child: Align(
                alignment: Alignment.centerLeft,
                // Same visual treatment as the approval card's risk-badge
                // (chat_screen.dart) — one "short caps label" language for
                // the whole app instead of a new style for this case.
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: const Color.fromRGBO(201, 165, 78, 0.55)),
                  ),
                  child: Text(
                    language!.toUpperCase(),
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 10, letterSpacing: 0.8, color: YggColors.accent),
                  ),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Text(code, style: const TextStyle(fontFamily: 'monospace', fontSize: 13.5, height: 1.4, color: YggColors.text)),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
            child: Align(
              alignment: Alignment.centerLeft,
              // Same pattern as the whole-message copy pill (chat_screen.dart)
              // — repeated per block, since a message can carry more than one
              // and the user usually wants one specific block, not the whole
              // message's prose too.
              child: GestureDetector(
                onTap: () => Clipboard.setData(ClipboardData(text: code)),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(borderRadius: BorderRadius.circular(999), border: Border.all(color: YggColors.hairline)),
                  child: Text(AppStrings.t('common.copy'), style: const TextStyle(fontSize: 11.5, color: YggColors.textMuted)),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
