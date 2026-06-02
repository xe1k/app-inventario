// Certificado HTTPS autofirmado para servir por la red local.
// La cámara de los navegadores móviles solo funciona en "contexto seguro":
// localhost o HTTPS. Para escanear desde celular/tablet por Wi-Fi necesitamos HTTPS.
// Generamos el certificado una sola vez (en data/) e incluimos las IPs de la red
// como SAN para que coincidan con la URL que se abre en el teléfono.
const fs = require('fs');
const os = require('os');
const path = require('path');
const selfsigned = require('selfsigned');

const DIR = path.join(__dirname, '..', 'data');
const KEY = path.join(DIR, 'key.pem');
const CERT = path.join(DIR, 'cert.pem');

// IPv4 de las interfaces de red (para acceder desde el celular).
function ipsLocales() {
  const ips = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const net of ifaces) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

// Devuelve { key, cert }. Genera el certificado si aún no existe.
async function obtenerCert() {
  if (fs.existsSync(KEY) && fs.existsSync(CERT)) {
    return { key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) };
  }

  const altNames = [
    { type: 2, value: 'localhost' },           // DNS
    { type: 7, ip: '127.0.0.1' },              // IP
    ...ipsLocales().map(ip => ({ type: 7, ip }))
  ];
  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: 'AppInventario' }],
    {
      keySize: 2048, algorithm: 'sha256',
      notAfterDate: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000), // ~10 años
      extensions: [{ name: 'subjectAltName', altNames }]
    }
  );

  fs.writeFileSync(KEY, pems.private);
  fs.writeFileSync(CERT, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

module.exports = { obtenerCert, ipsLocales };
