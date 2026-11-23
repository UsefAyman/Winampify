// electron-builder afterPack hook: castLabs VMP signature for the Mac app, so Spotify's
// protected audio plays in it. It must come before the Mac code signature, which
// electron-builder adds right after this hook. Linux Widevine has no VMP, so nothing to do there.
// Needs the castlabs-evs Python package and an EVS account (EVS_ACCOUNT_NAME / EVS_PASSWD).
const { execFileSync } = require('child_process');

exports.default = async function vmpSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (!process.env.EVS_ACCOUNT_NAME) {
    console.warn('  • VMP signing SKIPPED (no castLabs EVS account set): Spotify will not play in this Mac build');
    return;
  }
  const python = process.env.PYTHON || 'python3';
  console.log('  • VMP signing ' + context.appOutDir);
  execFileSync(python, ['-m', 'castlabs_evs.vmp', '-n', 'sign-pkg', context.appOutDir], { stdio: 'inherit' });
};
