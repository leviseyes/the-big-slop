"use client";
import {useState} from 'react';
import {Download, Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';

export default function ReferenceDownload({project}:{project:any}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const total=project.assets?.length || 0, ready=total>0 && project.assets.every((a:any)=>a.imageKey);
  if (!total) return null;
  return <div className="reference-download">
    <div><strong>Your reference collection</strong><p>{ready ? `${total} images · Originals organized by character, location and object` : 'Download all references once every image is ready.'}</p></div>
    <Button variant="outline" disabled={!ready || busy} onClick={async()=>{
      setBusy(true);setError('');setMessage('');
      const href=`/api/references/download?id=${encodeURIComponent(project.id)}`;
      try {
        const response=await fetch(`${href}&check=1`);const result=await response.json() as {error?:string};
        if (!response.ok) throw new Error(result.error || 'Could not prepare the reference download.');
        window.location.assign(href);
        setMessage('ZIP download requested. Check your browser’s downloads for progress.');
      } catch(e) {setError(e instanceof Error ? e.message : 'Could not start the download. Please try again.');}
      finally {setBusy(false);}
    }}>{busy ? <Loader2 className="spin"/> : <Download/>}{busy ? 'Preparing download…' : 'Download all references (ZIP)'}</Button>
    {message && <p className="reference-download-message" role="status">{message}</p>}
    {error && <p className="reference-download-message" role="alert">{error}</p>}
  </div>;
}
