import 'package:app/services/yggdrasil_client.dart';

typedef Handler = dynamic Function(Map<String, dynamic> params);

/// A gateway client that answers from a table instead of a socket.
class FakeClient extends YggdrasilClient {
  final Map<String, Handler> handlers;
  final List<String> calls = [];
  int disconnects = 0;

  FakeClient(this.handlers) : super(baseUrl: 'http://fake', apiKey: '');

  @override
  Future<dynamic> call(String method, Map<String, dynamic> params, {Duration? timeout}) async {
    calls.add(method);
    final handler = handlers[method];
    if (handler == null) throw StateError('no handler for $method');
    return handler(params);
  }

  @override
  void disconnect() => disconnects++;
}
