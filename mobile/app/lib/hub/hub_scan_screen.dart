import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../l10n/app_strings.dart';
import 'hub_link.dart';

/// Scans the QR the desktop shows in Ajustes → Teléfono (yggdrasil://hub?...)
/// and stores the Railway gateway URL + key. Pops with true once linked.
class HubScanScreen extends StatefulWidget {
  const HubScanScreen({super.key});

  @override
  State<HubScanScreen> createState() => _HubScanScreenState();
}

class _HubScanScreenState extends State<HubScanScreen> {
  final _controller = MobileScannerController(formats: const [BarcodeFormat.qrCode]);
  bool _handled = false;
  String? _hint;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_handled) return;
    for (final code in capture.barcodes) {
      final link = HubLink.parse(code.rawValue ?? '');
      if (link == null) {
        if (mounted) setState(() => _hint = AppStrings.t('hub.notOurQr'));
        continue;
      }
      _handled = true;
      await applyHubLink(link);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(AppStrings.t('hub.linked'))));
      Navigator.pop(context, true);
      return;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(AppStrings.t('hub.scanTitle'))),
      body: Stack(
        children: [
          MobileScanner(controller: _controller, onDetect: _onDetect),
          Align(
            alignment: Alignment.bottomCenter,
            child: Container(
              margin: const EdgeInsets.all(24),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.6), borderRadius: BorderRadius.circular(12)),
              child: Text(
                _hint ?? AppStrings.t('hub.scanHint'),
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
