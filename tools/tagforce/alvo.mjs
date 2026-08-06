// Onde esta o ISO. NAO fica no codigo: cada maquina tem o seu, e o caminho de
// ninguem tem por que ir pro git. Defina a variavel de ambiente TF_ISO:
//
//   PowerShell:  $env:TF_ISO = "C:\caminho\para\tagforce1.iso"
//   Bash:        export TF_ISO="/c/caminho/para/tagforce1.iso"
import fs from 'node:fs';

export function isoPath() {
  const p = process.env.TF_ISO;
  if (!p) {
    throw new Error('defina TF_ISO com o caminho do ISO do Tag Force 1 '
      + '(ex.: $env:TF_ISO = "C:\\...\\tagforce1.iso")');
  }
  if (!fs.existsSync(p)) throw new Error(`TF_ISO aponta para um arquivo que nao existe: ${p}`);
  return p;
}
