import 'dart:async';
import 'dart:io';

import 'package:web_socket_channel/web_socket_channel.dart';

/// True for errors that only mean "the phone can't reach its computer or
/// assistant right now" (closed/unopened socket, unreachable host, timeout), as
/// opposed to a real failure the gateway answered with. Lets screens show
/// "No estás conectado · Conectar" instead of "Bad state: WebSocket closed".
bool isConnectionError(Object error) {
  if (error is TimeoutException || error is SocketException || error is WebSocketChannelException) return true;
  if (error is StateError) return error.message.contains('WebSocket closed');
  return false;
}
