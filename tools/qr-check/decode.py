import json,sys,cv2,numpy as np
data=json.load(open(sys.argv[1],encoding='utf8')); bad=0
for d in data:
    m=np.array(d['m'],dtype=np.uint8); n=len(m); sc=10; q=4
    img=np.full(((n+2*q)*sc,(n+2*q)*sc),255,np.uint8)
    img[q*sc:(q+n)*sc,q*sc:(q+n)*sc]=np.kron(1-m,np.ones((sc,sc),np.uint8))*255
    val,_,_=cv2.QRCodeDetector().detectAndDecode(img)
    ok = val==d['t']; bad+= (not ok)
    print('v%d'%((n-17)//4), 'OK ' if ok else 'FAIL', repr(d['t'][:30]), '' if ok else '-> '+repr(val[:30]))
sys.exit(1 if bad else 0)
