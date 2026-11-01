import fs from 'node:fs'; import vm from 'node:vm';
const ctx={window:{}}; ctx.window=ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2],'utf8'),ctx);
const texts=['A','https://www.twitch.tv/activate?device-code=ABCDEFGH','https://www.twitch.tv/activate?device-code=WXYZ1234&x=ñ€',
 'x'.repeat(100),'https://example.com/'+'abc123'.repeat(20),'y'.repeat(150),'z'.repeat(200),'hello world 0123456789'];
const out=texts.map(t=>({t,m:JSON.parse(JSON.stringify(ctx.QR.matrix(t)))}));
fs.writeFileSync(process.argv[3],JSON.stringify(out));
console.log(out.map(o=>o.m.length).join(','));
