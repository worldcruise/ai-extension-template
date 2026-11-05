import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {ProtocolError as ContractError} from '../../src/protocol.mjs';

// The encryption key is injected by the hosting platform's secret manager,
// separately from the persistent encrypted volume. No provider key reaches Chrome.
export class ProtectedStore {
  constructor({directory,key}){this.directory=directory;this.key=Buffer.from(key||'','base64');}
  get configured(){return Boolean(this.directory)&&this.key.length===32;}
  file(id){if(!this.configured||!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw new ContractError('credential_storage_unavailable');return path.join(this.directory,id+'.enc');}
  async read(id){
    try {const value=JSON.parse(await readFile(this.file(id),'utf8'));const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(value.iv,'base64'));decipher.setAAD(Buffer.from(id));decipher.setAuthTag(Buffer.from(value.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]).toString('utf8'));}
    catch(error){if(error.code==='ENOENT')return null;throw new ContractError('credential_storage_unavailable');}
  }
  async write(id,value){
    const destination=this.file(id);await mkdir(this.directory,{recursive:true,mode:0o700});
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);
    cipher.setAAD(Buffer.from(id));const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    const temporary=destination+'.'+randomBytes(8).toString('hex');
    try{await writeFile(temporary,JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}),{mode:0o600,flag:'wx'});await rename(temporary,destination);}
    catch{await unlink(temporary).catch(()=>{});throw new ContractError('credential_storage_unavailable');}
  }
  async remove(id){try{await unlink(this.file(id));}catch(error){if(error.code!=='ENOENT')throw new ContractError('credential_storage_unavailable');}}
}
