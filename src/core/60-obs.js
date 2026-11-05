  // ---- OBS scene collection (studio.html) ---------------------------------

  // A v4 UUID from getRandomValues, which works on file:// pages where crypto.randomUUID may not exist.
  function uuid4() {
    var b = new Uint8Array(16);
    global.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // An OBS Studio scene collection (Scene Collection → Import) with one scene holding a Browser source per item.
  // items: [{ name, url, width, height, x, y, visible, audio }]. Positions are pixels on a 1920 × 1080 canvas,
  // top-left aligned. Only what OBS needs is written; everything else falls back to OBS's own defaults.
  function obsSceneCollection(opts) {
    var newId = opts.uuid || uuid4;
    var sceneName = opts.scene;
    var sources = [], items = [];
    opts.items.forEach(function (it, i) {
      var id = newId();
      var settings = { is_local_file: false, url: it.url, width: it.width, height: it.height };
      // Lets OBS mix the page's sound (alert sounds), so it reaches the stream and shows in the audio mixer.
      if (it.audio) settings.reroute_audio = true;
      sources.push({ id: 'browser_source', versioned_id: 'browser_source', name: it.name, uuid: id, settings: settings });
      items.push({
        name: it.name, source_uuid: id, id: i + 1, visible: it.visible !== false, locked: false,
        pos: { x: it.x, y: it.y }, scale: { x: 1, y: 1 }, rot: 0, align: 5, bounds_type: 0
      });
    });
    sources.unshift({
      id: 'scene', versioned_id: 'scene', name: sceneName, uuid: newId(),
      settings: { custom_size: false, id_counter: items.length, items: items }
    });
    return {
      name: opts.name,
      current_scene: sceneName,
      current_program_scene: sceneName,
      scene_order: [{ name: sceneName }],
      sources: sources,
      groups: [],
      transitions: [],
      quick_transitions: []
    };
  }

