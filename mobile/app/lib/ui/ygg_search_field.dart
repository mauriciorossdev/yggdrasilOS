import 'package:flutter/material.dart';

import '../theme/ygg_theme.dart';

/// Pill-shaped search input used above lists (chats, projects, sessions).
class YggSearchField extends StatelessWidget {
  final String hint;
  final ValueChanged<String> onChanged;
  final TextEditingController? controller;

  const YggSearchField({super.key, required this.hint, required this.onChanged, this.controller});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      decoration: BoxDecoration(color: YggColors.cardFillHigh, borderRadius: BorderRadius.circular(YggRadius.pill)),
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        style: TextStyle(color: YggColors.text, fontSize: 14),
        textAlignVertical: TextAlignVertical.center,
        cursorColor: YggColors.accent,
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: TextStyle(color: YggColors.textFaint),
          border: InputBorder.none,
          isDense: true,
          prefixIcon: Icon(Icons.search, color: YggColors.textFaint, size: 18),
        ),
      ),
    );
  }
}
