// Epic Richter AI: player Richter's Stopwatch crash sparkle and lightning (sotn-decomp
// src/ric/319C4.c RicEntityCrashStopwatchDoneSparkle) for boss Richter, as BO6 entity 0x2E.
// Linked at 0x801C7FEC, in place of the Vibhuti crash, which boss Richter never performs.
// The lightning's hitbox entity is left out, so the bolt does not hurt Alucard.
typedef unsigned char u8; typedef unsigned short u16; typedef short s16; typedef unsigned int u32; typedef int s32;
typedef struct Prim {
 struct Prim *next; u8 r0,g0,b0,type; s16 x0,y0; u8 u0,v0; u16 clut; u8 r1,g1,b1,p1; s16 x1,y1; u8 u1,v1; u16 tpage;
 u8 r2,g2,b2,p2; s16 x2,y2; u8 u2,v2; u16 priority; u8 r3,g3,b3,p3; s16 x3,y3; u8 u3,v3; u16 drawMode;
} Prim;
typedef char PrimSize[(sizeof(Prim)==52)?1:-1];
typedef struct Sparkle {
 s16 xlo,x,ylo,y; s32 vx,vy; s16 offx,offy; u16 face,pal; u8 blend,draw; s16 sx,sy,rot,px,py;
 u16 z,id; void *update; u16 step,sub,params,room; u32 flags;
 u8 pad38[0x64-0x38]; s32 prim; u8 pad68[0x7c-0x68];
 s16 size,flash,spin,angle,shade,heading; Prim *bolt; s16 segment,active,boltX,boltY,target;
 u8 pad96[0xbc-0x96];
} Sparkle;
typedef char SparkleSize[(sizeof(Sparkle)==188)?1:-1];
#define PRIMS ((Prim*)0x80086fec)
#define RIC_Z (*(volatile u16*)(0x800733d8+64*188+0x24))
#define API(a) (*(void**)(a))
static s32 (*const rnd)(void)=(void*)0x800160e4;
static s32 (*const rsin)(s32)=(void*)0x80016c9c;
static s32 (*const rcos)(s32)=(void*)0x80016d68;
static void (*const destroy)(void*)=(void*)0x801acf6c;
#define ALLOC(type,n) ((s32(*)(s32,s32))API(0x8003c7b8))(type,n)
#define SFX(id) ((void(*)(s32))API(0x8003c7dc))(id)
enum {HIDE=8, BASE_MODE=0x20|0x10|0x04|0x02|0x01};

// Out of line so no multiply follows an mflo within two instructions (R3000 hi/lo hazard).
static s32 __attribute__((noinline)) mul(s32 a,s32 b) {return a*b;}
static void Square(Prim *p,s32 x,s32 y,s32 r) {
 p->x0=p->x2=x-r;p->x1=p->x3=x+r;p->y0=p->y1=y-r;p->y2=p->y3=y+r;
}
static void Star(Prim *p,s32 x,s32 y,s32 a,s32 b,s32 c,s32 d,s32 flip) {
 // The two spinning star halves (a=cos*r, b=sin*r, c and d the same at r/8).
 if(!flip) {
  p->x0=x+((-a+b)>>12);p->y0=y+((-b-a)>>12);p->x1=x+((c+d)>>12);p->y1=y+((d-c)>>12);
  p->x2=x+((-c-d)>>12);p->y2=y+((-d+c)>>12);p->x3=x+((a-b)>>12);p->y3=y+((b+a)>>12);
 } else {
  p->x0=x+((-c+d)>>12);p->y0=y+((-d-c)>>12);p->x1=x+((a+b)>>12);p->y1=y+((b-a)>>12);
  p->x2=x+((-a-b)>>12);p->y2=y+((-b+a)>>12);p->x3=x+((c-d)>>12);p->y3=y+((d+c)>>12);
 }
}
static void Flash(Prim *p,u32 mode,s32 u,s32 v,s32 w,s32 h,u8 rg,u8 b) {
 p->priority=0xC2;p->drawMode=mode;p->tpage=0x1A;p->clut=0x19F;
 p->u0=p->u2=u;p->u1=p->u3=u+w;p->v0=p->v1=v;p->v2=p->v3=v+h;
 p->r0=p->r1=p->r2=p->r3=p->g1=p->g2=p->g3=rg;p->b0=p->b1=p->b2=p->b3=b;
}

void StopwatchSparkle(Sparkle *self) {
 Prim *prim;
 s32 i;
 switch(self->step) {
 case 0:
  self->prim=ALLOC(4,20);
  if(self->prim==-1) {destroy(self);return;}
  self->flags=0x04000000|0x08000000|0x800000;
  prim=&PRIMS[self->prim];
  Flash(prim,BASE_MODE,0,0xC0,0x3F,0x3F,0x40,0x80);prim=prim->next;
  Flash(prim,BASE_MODE|HIDE,0x40,0xC0,0x3F,0x3F,0x40,0x80);prim=prim->next;
  Flash(prim,BASE_MODE|HIDE|0x400|0x40,0xB,0xCB,0x2A,0x2A,0xCF,0xFF);prim=prim->next;
  Flash(prim,BASE_MODE|HIDE|0x400|0x40,0xB,0xCB,0x2A,0x2A,0xCF,0xFF);
  self->bolt=prim->next;
  for(i=0;i<16;i++) {
   prim=prim->next;
   prim->priority=RIC_Z+3;prim->drawMode=BASE_MODE|HIDE;prim->tpage=0x1A;prim->clut=0x194;
   prim->u0=prim->u2=rnd()%5*0x10+0x90;prim->u1=prim->u3=prim->u0+0x10;
   prim->v0=prim->v1=0xC0;prim->v2=prim->v3=0xD0;
   prim->r0=prim->r1=prim->r2=prim->r3=prim->g1=prim->g2=prim->g3=prim->b0=prim->b1=prim->b2=prim->b3=0x80;
  }
  self->size=4;self->flash=self->spin=self->angle=0;self->segment=self->active=0;
  self->step++;
  break;
 case 1:
  if(++self->size>=0x10) {
   self->flash=4;
   prim=PRIMS[self->prim].next;
   for(i=0;i<3;i++) {prim->drawMode&=~HIDE;prim=prim->next;}
   self->spin=0x10;self->angle=0;
   SFX(0x614);
   self->step++;
  }
  break;
 case 2:
  if(--self->size<=0) {
   prim=&PRIMS[self->prim];
   prim->drawMode|=HIDE;prim->next->drawMode|=HIDE;
   self->shade=0xFF;self->active=1;
   self->heading=self->face?0xA00:0xE00;
   self->target=self->face?0x700:0x100;
   self->boltX=self->x;self->boltY=self->y;
   self->step++;
  }
  self->flash+=2;self->spin+=2;self->angle=(self->angle+0x80)&0xFFF;
  break;
 case 3:
  self->shade-=0x10;
  if(self->shade<0x80) {
   prim=PRIMS[self->prim].next->next;
   prim->drawMode|=HIDE;prim->next->drawMode|=HIDE;
   self->step++;
  }
  self->angle=(self->angle+0x80)&0xFFF;
  break;
 case 4:
  if(!self->active) {destroy(self);return;}
  break;
 }
 prim=&PRIMS[self->prim];
 s32 x=self->x,y=self->y;
 if(self->step==1 || self->step==2)Square(prim,x,y,self->size);
 if(self->step==2 || self->step==3) {
  s32 sine=rsin(self->angle),cosine=rcos(self->angle);
  s32 a=mul(cosine,self->spin),b=mul(sine,self->spin),c=mul(cosine,self->spin/8),d=mul(sine,self->spin/8);
  prim=prim->next;
  if(self->step==2)Square(prim,x,y,self->flash);
  prim=prim->next;
  Star(prim,x,y,a,b,c,d,0);
  if(self->step==3) {
   prim->r0=prim->r1=prim->r2=prim->r3=prim->g1=prim->g2=prim->g3=self->shade-0x20;
   prim->b0=prim->b1=prim->b2=prim->b3=self->shade;
  }
  prim=prim->next;
  Star(prim,x,y,a,b,c,d,1);
  if(self->step==3) {
   prim->g1=prim->g2=prim->g3=self->shade-0x20;
   prim->b0=prim->b1=prim->b2=prim->b3=self->shade;
  }
 }
 if(self->active) {
  self->active=0;
  prim=self->bolt;
  for(i=0;i<16;i++) {
   if(i==self->segment) {
    if(self->boltX<0x120 && self->boltX>-0x20 && self->boltY<0x120 && self->boltY>-0x20) {
     prim->drawMode&=~HIDE;
     s32 turn=!(i%4)?rnd()%0x200+0x200:rnd()%0x80+0x80;
     s32 delta=self->heading-self->target;
     if(delta>0x800 || delta<-0x800)delta+=delta<0?0x1000:-0x1000;
     if(delta>0)turn=-turn;
     self->heading=(self->heading+turn)&0xFFF;
     s32 sine=rsin(self->heading),cosine=rcos(self->heading);
     prim->x0=self->boltX+(-(sine*-8)>>12);prim->y0=self->boltY+((cosine*-8)>>12);
     prim->x1=self->boltX+((cosine*16-sine*-8)>>12);prim->y1=self->boltY+((sine*16+cosine*-8)>>12);
     prim->x2=self->boltX+(-(sine*8)>>12);prim->y2=self->boltY+(cosine*8>>12);
     prim->x3=self->boltX+((cosine*16-sine*8)>>12);prim->y3=self->boltY+((sine*16+cosine*8)>>12);
     prim->r0=0x80;
     self->boltX+=(cosine*16)>>12;self->boltY+=(sine*16)>>12;
    } else prim->drawMode|=HIDE;
   } else {
    prim->r0-=8;
    if(prim->r0<0x20)prim->drawMode|=HIDE;
   }
   prim->r1=prim->r2=prim->r3=prim->g0=prim->g1=prim->g2=prim->g3=prim->b0=prim->b1=prim->b2=prim->b3=prim->r0;
   self->active|=prim->drawMode&HIDE?0:1;
   prim=prim->next;
  }
  if(++self->segment>=0x10)self->segment=0;
 }
}
