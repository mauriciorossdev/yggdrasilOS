import 'package:flutter/material.dart';

import '../theme/ygg_theme.dart';

/// Fades a chat bubble in (0.5s) the first time it is built. Used by both the
/// gateway and standalone chats for user and assistant messages alike.
class FadeInBubble extends StatefulWidget {
  final bool animate;
  final Widget child;
  const FadeInBubble({super.key, required this.animate, required this.child});

  @override
  State<FadeInBubble> createState() => _FadeInBubbleState();
}

class _FadeInBubbleState extends State<FadeInBubble>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 500),
    value: widget.animate ? 0 : 1,
  );

  @override
  void initState() {
    super.initState();
    if (widget.animate) _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
    opacity: CurvedAnimation(parent: _controller, curve: Curves.easeOut),
    child: widget.child,
  );
}

/// Tracks which items have already been shown so only newly added ones fade
/// in (not history, and not items re-built after scrolling off-screen), and
/// whether the list is scrolled away from the latest message.
class ChatListTracker {
  final ScrollController scroll;
  final ValueNotifier<bool> showJump = ValueNotifier(false);
  final Set<String> _seen = {};
  bool _historyDone = false;
  bool get historyDone => _historyDone;

  ChatListTracker(this.scroll) {
    scroll.addListener(_onScroll);
  }

  void _onScroll() {
    if (!scroll.hasClients) return;
    final away = scroll.position.maxScrollExtent - scroll.position.pixels > 120;
    if (away != showJump.value) showJump.value = away;
  }

  /// Call once the initial history is in `ids`: those never fade.
  void markHistory(Iterable<String> ids) {
    _seen.addAll(ids);
    _historyDone = true;
    _onScroll();
  }

  /// True only the first time [id] is built after history finished loading.
  bool shouldAnimate(String id) {
    final first = _seen.add(id);
    return first && _historyDone;
  }

  void dispose() {
    scroll.removeListener(_onScroll);
    showJump.dispose();
  }
}

/// Floating down-arrow, shown while the list is scrolled away from the latest
/// message; jumps to the end and hides itself on arrival.
class ScrollToBottomButton extends StatelessWidget {
  final ChatListTracker tracker;
  const ScrollToBottomButton({super.key, required this.tracker});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: tracker.showJump,
      builder: (context, show, _) => IgnorePointer(
        ignoring: !show,
        child: AnimatedOpacity(
          opacity: show ? 1 : 0,
          duration: const Duration(milliseconds: 200),
          child: Material(
            color: YggColors.accent,
            shape: const CircleBorder(),
            elevation: 4,
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: () {
                final c = tracker.scroll;
                if (!c.hasClients) return;
                c.animateTo(
                  c.position.maxScrollExtent,
                  duration: const Duration(milliseconds: 300),
                  curve: Curves.easeOut,
                );
              },
              child: const Padding(
                padding: EdgeInsets.all(10),
                child: Icon(
                  Icons.arrow_downward,
                  size: 22,
                  color: YggColors.surface,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
