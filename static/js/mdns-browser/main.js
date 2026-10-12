/**
 * Unified host discovery for Tizen using HTTP Subnet sweep.
 * Tizen Smart TVs cannot use Chrome App APIs (chrome.sockets.udp).
 * This scanner queries webapis.network for local IP and sweeps the /24 subnet.
 */

function findNvService(ipString) {
  var ip = ipString.replace('ipv4:', '');

  var discoveredHost = new NvHTTP(ip, myUniqueid);
  discoveredHost.pollServer(function(returnedDiscoveredHost) {
    if (!returnedDiscoveredHost.online) {
      return;
    }
    if (hosts[returnedDiscoveredHost.serverUid] != null) {
      hosts[returnedDiscoveredHost.serverUid].address = returnedDiscoveredHost.address;
      if (typeof hosts[returnedDiscoveredHost.serverUid].updateExternalAddressIP4 === 'function') {
        hosts[returnedDiscoveredHost.serverUid].updateExternalAddressIP4();
      }
      saveHosts();
    } else {
      addHostToGrid(returnedDiscoveredHost, true);
      beginBackgroundPollingOfHost(returnedDiscoveredHost);
      saveHosts();
    }
  });
}

window.subnetScanAbortCtrl = null;
window.subnetScanPromise = null;

function startSubnetScanner() {
  if (window.subnetScanPromise) {
    return window.subnetScanPromise;
  }

  window.subnetScanPromise = new Promise(function(resolve) {
    try {
      var localIp = null;
      if (typeof webapis !== 'undefined' && webapis.network && typeof webapis.network.getIp === 'function') {
        localIp = webapis.network.getIp();
      } else if (typeof tizen !== 'undefined' && tizen.systeminfo) {
        try {
          // fallback
          localIp = null;
        } catch(e) {}
      }

      if (!localIp) {
        console.warn('[startSubnetScanner] Local IP not detectable via webapis.network. Trying common subnets...');
        // Default to common 192.168.1.x and 192.168.0.x if local IP couldn't be resolved
        localIp = '192.168.1.1';
      }

      var parts = localIp.split('.');
      if (parts.length !== 4) {
        window.subnetScanPromise = null;
        return resolve();
      }

      var subnet = parts[0] + '.' + parts[1] + '.' + parts[2];
      console.log('[startSubnetScanner] Sweeping subnet:', subnet + '.0/24');

      if (window.subnetScanAbortCtrl) {
        window.subnetScanAbortCtrl.abort();
      }
      window.subnetScanAbortCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;

      var IPs = [];
      for (var i = 1; i <= 254; i++) {
        IPs.push(subnet + '.' + i);
      }

      var index = 0;
      var activeCount = 0;
      var concurrency = 32; // safe concurrency on older TV hardware

      function scanNext() {
        if (!window.subnetScanAbortCtrl || index >= IPs.length) {
          if (activeCount === 0) {
            window.subnetScanPromise = null;
            resolve();
          }
          return;
        }

        var ip = IPs[index++];
        activeCount++;

        var localAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timeoutId = setTimeout(function() {
          if (localAbort) localAbort.abort();
        }, 1200);

        var onGlobalAbort = function() {
          if (localAbort) localAbort.abort();
        };

        if (window.subnetScanAbortCtrl) {
          window.subnetScanAbortCtrl.signal.addEventListener('abort', onGlobalAbort);
        }

        // Probe Sunshine / GFE HTTP port
        fetch('http://' + ip + ':47989/serverinfo', localAbort ? { signal: localAbort.signal } : {})
          .then(function(res) {
            clearTimeout(timeoutId);
            if (res.ok) {
              console.log('[startSubnetScanner] Discovered Sunshine/GFE host at:', ip);
              findNvService('ipv4:' + ip);
            }
            if (window.subnetScanAbortCtrl) window.subnetScanAbortCtrl.signal.removeEventListener('abort', onGlobalAbort);
            activeCount--;
            scanNext();
          })
          .catch(function() {
            clearTimeout(timeoutId);
            if (window.subnetScanAbortCtrl) window.subnetScanAbortCtrl.signal.removeEventListener('abort', onGlobalAbort);
            activeCount--;
            scanNext();
          });
      }

      for (var c = 0; c < Math.min(concurrency, IPs.length); c++) {
        scanNext();
      }
    } catch (e) {
      console.error('[startSubnetScanner] Failed:', e);
      window.subnetScanPromise = null;
      resolve();
    }
  });

  return window.subnetScanPromise;
}
