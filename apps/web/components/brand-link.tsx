import Image from 'next/image';
export function BrandLink(){
 return <a className="wordmark" href="/"><Image className="brand-logo" src="/logo.png" width={48} height={48} alt="" priority/>Find Me a Time</a>;
}
