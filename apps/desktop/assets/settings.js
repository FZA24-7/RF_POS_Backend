(function () {
  var api = window.mafkDesktop;
  var addr = document.getElementById('addr');
  var msg = document.getElementById('msg');
  var save = document.getElementById('save');
  var force = document.getElementById('force');
  var cancel = document.getElementById('cancel');

  function show(text, isError) {
    msg.textContent = text;
    msg.className = isError ? 'err' : '';
  }

  api.getInfo().then(function (info) {
    if (info && info.serverUrl) addr.value = info.serverUrl;
  });

  function submit(isForced) {
    save.disabled = true;
    force.hidden = true;
    show('Testing the connection…', false);
    api.setServer(addr.value, isForced).then(
      function (res) {
        save.disabled = false;
        if (res && res.ok) {
          show('Saved.', false);
        } else {
          show((res && res.error) || 'Could not save.', true);
          if (res && res.canForce) force.hidden = false;
        }
      },
      function () {
        save.disabled = false;
        show('Could not save.', true);
      },
    );
  }

  save.addEventListener('click', function () {
    submit(false);
  });
  force.addEventListener('click', function () {
    submit(true);
  });
  cancel.addEventListener('click', function () {
    api.closeSettings();
  });
  addr.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') submit(false);
  });
})();
