import 'local_workflow.dart';

/// `{{path}}` lookups over the run context. Path roots: `steps.<saveAs>` and
/// `now` (epoch ms). A string that is exactly one `{{path}}` keeps the raw
/// value (num/bool/map); anything mixed becomes text. No eval, no expressions
/// beyond dotted paths and list indexes (`steps.x.apps.0.name`).
final _template = RegExp(r'\{\{\s*([^}]+?)\s*\}\}');

Object? resolvePath(String path, Map<String, dynamic> context) {
  Object? cur = context;
  for (final part in path.split('.')) {
    if (cur is Map) {
      cur = cur[part];
    } else if (cur is List) {
      final i = int.tryParse(part);
      if (i == null || i < 0 || i >= cur.length) return null;
      cur = cur[i];
    } else {
      return null;
    }
  }
  return cur;
}

Object? resolveValue(Object? raw, Map<String, dynamic> context) {
  if (raw is String) {
    final whole = _template.firstMatch(raw);
    if (whole != null && whole.start == 0 && whole.end == raw.length) {
      return resolvePath(whole.group(1)!, context);
    }
    return raw.replaceAllMapped(_template, (m) => '${resolvePath(m.group(1)!, context) ?? ''}');
  }
  if (raw is Map) return raw.map((k, v) => MapEntry(k, resolveValue(v, context)));
  if (raw is List) return raw.map((v) => resolveValue(v, context)).toList();
  return raw;
}

bool evaluateCondition(Condition c, Map<String, dynamic> context) {
  final left = resolveValue(c.left, context);
  final right = c.right == null ? null : resolveValue(c.right, context);
  switch (c.op) {
    case 'exists':
      return left != null && left.toString().isNotEmpty;
    case 'eq':
      return _same(left, right);
    case 'neq':
      return !_same(left, right);
    case 'contains':
      return (left?.toString() ?? '').contains(right?.toString() ?? '');
    case 'gt':
      return _num(left) != null && _num(right) != null && _num(left)! > _num(right)!;
    case 'lt':
      return _num(left) != null && _num(right) != null && _num(left)! < _num(right)!;
    default:
      throw ArgumentError('unknown op ${c.op}');
  }
}

bool _same(Object? a, Object? b) {
  final na = _num(a), nb = _num(b);
  if (na != null && nb != null) return na == nb;
  return (a?.toString() ?? '') == (b?.toString() ?? '');
}

num? _num(Object? v) => v is num ? v : (v is String ? num.tryParse(v) : null);
