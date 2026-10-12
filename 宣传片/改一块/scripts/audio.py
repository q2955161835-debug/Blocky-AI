"""Original procedural score and synchronized toy sound effects."""
import pathlib, wave, json
import numpy as np

root=pathlib.Path(__file__).resolve().parents[3]
out=root/'try'/'待清理'/'宣传片试制-2026-10-12';out.mkdir(parents=True,exist_ok=True)
sr=48000;duration=60;n=sr*duration
mix=np.zeros((n,2),dtype=np.float32);rng=np.random.default_rng(20261012)
def add(start,signal,vol=.1,pan=0):
    a=int(start*sr);b=min(n,a+len(signal));signal=signal[:b-a];p=(pan+1)*np.pi/4
    mix[a:b,0]+=signal*vol*np.cos(p);mix[a:b,1]+=signal*vol*np.sin(p)
def tone(freq,length,kind='bell'):
    t=np.arange(int(length*sr))/sr
    if kind=='bell':return (np.sin(2*np.pi*freq*t)+.23*np.sin(2*np.pi*freq*2.003*t)+.11*np.sin(2*np.pi*freq*3.98*t))*np.exp(-t*5/length)*np.minimum(t/.008,1)
    if kind=='pad':return (np.sin(2*np.pi*freq*t)+.22*np.sin(2*np.pi*(freq*1.002)*t)+.10*np.sin(2*np.pi*freq*2*t))*np.sin(np.pi*np.minimum(t/length,1))**2
    return np.sin(2*np.pi*freq*t)*np.exp(-t*8/length)
def hz(midi):return 440*2**((midi-69)/12)
# Restrained D-minor motif opens into F major after the block replacement.
for start in np.arange(0,32,4):
    chord=[50,57,62,65] if int(start/4)%2==0 else [46,53,58,62]
    for i,m in enumerate(chord):add(start,tone(hz(m),5.0,'pad'),.026,(-.5+i/3))
for start in np.arange(.4,32,.75):
    seq=[74,69,72,65,74,69,77,72];m=seq[int(start/.75)%8]
    add(start,tone(hz(m),.65),.045,np.sin(start)*.45)
for start in np.arange(35,58,4):
    chord=[53,60,65,69] if int((start-35)/4)%2==0 else [58,65,70,74]
    for i,m in enumerate(chord):add(start,tone(hz(m),5,'pad'),.043,(-.55+i/3))
for start in np.arange(35.25,55,.375):
    seq=[77,72,69,72,81,77,72,69];add(start,tone(hz(seq[int((start-35.25)/.375)%8]),.5),.045,np.sin(start*.4)*.5)
for start in np.arange(16,32,.75):
    t=np.arange(int(.20*sr))/sr;s=np.sin(2*np.pi*(50*t+55*(1-np.exp(-t*20))/20))*np.exp(-t*25);add(start,s,.105)
for start in np.arange(35,55,.6667):
    t=np.arange(int(.23*sr))/sr;add(start,np.sin(2*np.pi*(46*t+58*(1-np.exp(-t*28))/28))*np.exp(-t*22),.12)
for start in np.arange(35.333,55,.6667):
    t=np.arange(int(.035*sr))/sr;add(start,rng.normal(0,.18,len(t))*np.exp(-t*110),.12,.3)
# Plastic steps, two matched impacts and rewind gestures.
for start in [.25,.66,1.07,1.48,1.89,2.30,4.75,5.16,5.57,5.98,6.39,6.80]:
    add(start,tone(420,.055)+rng.normal(0,.025,int(.055*sr)),.08,-.15)
for start in [2.58,7.08]:
    t=np.arange(int(.28*sr))/sr;add(start,np.sin(2*np.pi*115*t)*np.exp(-t*24)+rng.normal(0,.22,len(t))*np.exp(-t*60),.20,.25)
for start in [4.34,8.84]:
    t=np.arange(int(.16*sr))/sr;add(start,np.sin(2*np.pi*(700*t-1600*t*t))*np.sin(np.pi*t/.16),.055,-.4)
for start in [26.3,30.2,35.1]:
    t=np.arange(int(1.05*sr))/sr;noise=rng.normal(0,1,len(t));sm=np.convolve(noise,np.ones(100)/100,mode='same');add(start,sm*np.sin(np.pi*t/1.05),.38,.2)
# Brief silence gives the decisive click room to land.
mix[int(32.5*sr):int(33.5*sr)]*=np.linspace(1,0,int(sr))[:,None]
mix[int(33.5*sr):int(34.5*sr)]*=.08
t=np.arange(int(.18*sr))/sr;click=rng.normal(0,.45,len(t))*np.exp(-t*80)+np.sin(2*np.pi*1100*t)*np.exp(-t*45);add(33.5,click,.38)
for start,m in [(35,65),(35.12,69),(35.24,72),(50.5,86),(52.3,89),(55.7,74),(56,77),(56.3,81)]:add(start,tone(hz(m),1.0),.10)
fade=np.ones(n);fade[-int(1.5*sr):]=np.linspace(1,0,int(1.5*sr));mix*=fade[:,None]
peak=float(np.max(np.abs(mix)));mix*=.78/max(peak,.01)
pcm=(np.clip(mix,-1,1)*32767).astype('<i2')
with wave.open(str(out/'score.wav'),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(sr);f.writeframes(pcm.tobytes())
(out/'audio-source.json').write_text(json.dumps({'duration':60,'sample_rate':sr,'channels':2,'source':'Original procedural composition and toy effects, no external recording','peak_before_normalization':peak,'events':{'impacts':[2.58,7.08],'swap':33.5,'unfold':35.1,'logo':[55.7,56,56.3]}},indent=2),encoding='utf-8')
print('AUDIO_READY',out/'score.wav')
