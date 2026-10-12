// Epic Richter AI: player Richter's Stopwatch item crash for boss Richter (BO6).
// Linked at 0x801CF0A0, in place of the old four-clock visual. Zig 0.13.0:
// zig cc -target mipsel-freestanding-none -mcpu=mips1 -Os -fno-pic -mno-abicalls -G0
typedef unsigned char u8; typedef unsigned short u16; typedef short s16; typedef unsigned int u32; typedef int s32;
typedef struct Entity {
 s32 x,y,vx,vy; s16 offx,offy; u16 face,pal; u8 blend,draw; s16 sx,sy,rot,px,py;
 u16 z,id; void (*update)(struct Entity*); u16 step,sub,params,room; u32 flags;
 u16 unused,enemy,box; s16 hp,attack; u16 element,hit; u8 width,height,hitflags,inv;
 s16 unk4a; void *anim; u16 pose; s16 poseTimer,bank; u16 frame; s16 stun;u16 page;
 struct Entity *parent,*next; s32 prim; u16 unk68,hitEffect; u8 opacity,unk6d[11];s32 unk78;u32 ext[15];struct Entity *unkb8;
} Entity;
typedef char EntitySize[(sizeof(Entity)==188)?1:-1];
#define ENT ((volatile Entity*)0x800733d8)
#define RIC (ENT+64)
#define U32(a) (*(volatile u32*)(a))
#define MARK 0x52494346
typedef struct { u32 active,frame,phase,clock,stance; } State;
#define F (*(volatile State*)0x801cf3a0)
// Clocks 1-3 for the chain (player D_801758D4) and the last clock created (player D_801758D0).
#define CHAIN ((Entity* volatile*)0x801cf3b4)
#define LAST U32(0x801cf3c0)
#define TIME_STOP U32(0x800973fc)
static void (*const finisherClock)(Entity*)=(void*)0x801cf77c;
static Entity *(*const factory)(Entity*,u32,s32)=(void*)0x801bbdc0;
static void (*const destroy)(Entity*)=(void*)0x801acf6c;

// Marks queued crash factories so the finisher's cleanup can remove them.
static void Tag(void) {
 for(Entity *e=(Entity*)(ENT+68);e<(Entity*)(ENT+80);e++)
  if(e->id==1 && e->step==0 && (e->params==44 || e->params==63 || e->params==65 || e->params==66))e->ext[14]=MARK;
}

// Entity 0x37. Crash clocks (params 0x100-0x400) follow the previous clock, keep time stopped until the
// last one ends and finish with the Stopwatch crash lightning (player RicEntitySubwpnStopwatch).
void Stopwatch(Entity *e) {
 u32 index=e->params>>8&0xff;
 if(!index) {finisherClock(e);return;}
 u32 step=e->step;
 if(!step) {
  if(index<4)CHAIN[index-1]=e;
  LAST=index;
  if(index>1 && F.active && F.phase && F.phase!=5)e->ext[10]=MARK;
 }
 // Only the last clock releases Alucard.
 if(step==7 && index!=LAST)e->ext[10]=0;
 u32 stop=TIME_STOP;
 s32 x=RIC->x,y=RIC->y; s16 offy=RIC->offy; u8 height=RIC->height;
 u32 follow=index>1 && step && step<5;
 if(follow) {
  // The native clock eases toward RIC + (8 behind, 16 up): aim it at the previous clock instead.
  Entity *prev=CHAIN[index-2];
  s32 back=RIC->face?0x80000:-0x80000;
  if(prev) {RIC->x=prev->x+back;RIC->y=prev->y;}
  else {RIC->x=e->x-back;RIC->y=e->y+0x100000;}
  RIC->offy=0;RIC->height=0;
 }
 finisherClock(e);
 if(follow) {RIC->x=x;RIC->y=y;RIC->offy=offy;RIC->height=height;}
 if(!e->id) {
  if(index<4 && CHAIN[index-1]==e)CHAIN[index-1]=0;
  if(index!=LAST)TIME_STOP=stop;
  return;
 }
 if(step==4 && e->step==5) {
  // Crash clocks skip the shrink and strike lightning.
  e->step=7;
  factory(e,0x36,0);
 }
}

// Entity 0x39: four clocks 16 frames apart (player RicEntityCrashStopwatch).
void CrashStopwatch(Entity *e) {
 u32 step=e->step;
 if(!step) {e->flags=0x04000000;e->ext[0]=0;step=1;}
 if(step>=8) {destroy(e);return;}
 if(step&1) {
  e->ext[0]++;
  factory(e,0x3f|e->ext[0]<<16,0);
  e->ext[1]=0;step++;
 } else if(++e->ext[1]>15)step++;
 e->step=step;
 if(F.active && F.phase)Tag();
}
