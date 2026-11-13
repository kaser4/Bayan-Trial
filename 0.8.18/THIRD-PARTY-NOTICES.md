# TWP acknowledgements

The service adapter file `web-services.js` and paragraph/viewport translator `page.js` are derived in part from the algorithms and request formats in TWP (Translate Web Pages), by FilipePS and contributors:

- https://github.com/FilipePS/Traduzir-paginas-web
- https://github.com/FilipePS/Traduzir-paginas-web/blob/master/src/background/translationService.js
- https://github.com/FilipePS/Traduzir-paginas-web/blob/master/src/background/textToSpeech.js
- https://github.com/FilipePS/Traduzir-paginas-web/blob/master/src/contentScript/pageTranslator.js

Those two files are provided in editable source form under the Mozilla Public License 2.0. The complete license is included in `licenses/TWP-MPL-2.0.txt`. Modifications for Bayan include MV3 Fetch transport, validated paragraph markers, per-provider in-memory cache, viewport-first lazy queues, explicit failover, and cancellable audio chunks. No private service credentials are included. The interface and floating window remain Bayan's own implementation. This is an independent project, not an official TWP release.
