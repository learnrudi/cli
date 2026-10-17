/* macOS task containment: kernel audit-session membership and generation-bound signals.
 * No process-tree/argv matching and no numeric-PID kill fallback. */
#include <mach/mach.h>
#include <libproc.h>
#include <bsm/libbsm.h>
#include <errno.h>
#include <inttypes.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_PIDS 65536
/* Darwin 24 proc_info_private.h: PROC_PIDUNIQIDENTIFIERINFO is a 56-byte API.
 * p_uniqueid is the boot-local creation counter, independent of wall time. */
struct task_unique_info {
    uint8_t uuid[16]; uint64_t unique, parent; int32_t version, parent_version;
    uint64_t reserved[2];
};
_Static_assert(sizeof(struct task_unique_info)==56,"Darwin process identity ABI");
static int unique_for(pid_t pid,struct task_unique_info *info) {
    return proc_pidinfo(pid,17,1,info,sizeof(*info))==sizeof(*info);
}
_Noreturn static void fail(const char *message) { fprintf(stderr,"task audit: %s\n",message); exit(1); }
static uint64_t number(const char *value, uint64_t max) {
    if (!value || !*value || strspn(value,"0123456789") != strlen(value)) fail("invalid number");
    char *end; errno=0; unsigned long long result=strtoull(value,&end,10);
    if(errno || *end || result>max) fail("number out of range");
    return result;
}
static int token_for(pid_t pid, audit_token_t *token) {
    mach_port_t port=MACH_PORT_NULL;
    kern_return_t status=task_name_for_pid(mach_task_self(),pid,&port);
    if(status!=KERN_SUCCESS) return -1;
    mach_msg_type_number_t count=TASK_AUDIT_TOKEN_COUNT;
    status=task_info(port,TASK_AUDIT_TOKEN,(task_info_t)token,&count);
    mach_port_deallocate(mach_task_self(),port);
    return status==KERN_SUCCESS && count==TASK_AUDIT_TOKEN_COUNT ? 0 : -1;
}
static int bsd_for(pid_t pid, struct proc_bsdinfo *info) {
    return proc_pidinfo(pid,PROC_PIDTBSDINFO,0,info,sizeof(*info)) == sizeof(*info);
}
static int matches(audit_token_t token,pid_t pid,uint32_t version) {
    return audit_token_to_pid(token)==pid && (uint32_t)audit_token_to_pidversion(token)==version;
}
static int anchor(pid_t pid,uint32_t version,au_asid_t asid) {
    audit_token_t token;
    return pid>1 && !token_for(pid,&token) && matches(token,pid,version)
        && audit_token_to_asid(token)==asid && audit_token_to_euid(token)==getuid();
}
static void identity(pid_t pid) {
    audit_token_t token; struct proc_bsdinfo b;struct task_unique_info id;
    if(token_for(pid,&token) || !bsd_for(pid,&b) || !unique_for(pid,&id)) fail("identity unavailable");
    if(!matches(token,pid,(uint32_t)id.version) || audit_token_to_euid(token)!=b.pbi_uid) fail("identity changed");
    printf("{\"pid\":%d,\"version\":%u,\"asid\":%u,\"uid\":%u,\"unique\":\"%" PRIu64 "\"}\n",
        pid,(uint32_t)audit_token_to_pidversion(token),(uint32_t)audit_token_to_asid(token),b.pbi_uid,id.unique);
}
static void sweep(int argc,char **argv) {
    if(argc!=9) fail("invalid sweep arguments");
    au_asid_t asid=(au_asid_t)number(argv[2],INT32_MAX);
    uint64_t owner_unique=number(argv[3],UINT64_MAX);
    pid_t owner=(pid_t)number(argv[4],INT32_MAX), guardian=(pid_t)number(argv[6],INT32_MAX);
    uint32_t owner_version=(uint32_t)number(argv[5],UINT32_MAX), guardian_version=(uint32_t)number(argv[7],UINT32_MAX);
    int signal_number=(int)number(argv[8],SIGKILL);
    if(asid<100000 || owner<2 || signal_number!=SIGKILL) fail("invalid scope");
    if(!anchor(owner,owner_version,asid) && !anchor(guardian,guardian_version,asid)) fail("both session anchors unavailable; quarantine required");
    pid_t *pids=calloc(MAX_PIDS,sizeof(pid_t)); if(!pids)fail("allocation failed");
    struct task_unique_info census_identity;
    if(!unique_for(getpid(),&census_identity) || !owner_unique || owner_unique>=census_identity.unique || census_identity.unique>INT64_MAX)fail("census identity unavailable");
    struct task_unique_info owner_identity;
    if(anchor(owner,owner_version,asid) && (!unique_for(owner,&owner_identity) || owner_identity.unique!=owner_unique))fail("owner creation identity mismatch");
    int count=proc_listallpids(pids,MAX_PIDS*sizeof(pid_t));
    if(count<=0 || count>=MAX_PIDS)fail("incomplete process census");
    int reached_kernel=0;
    for(int i=0;i<count;i++)if(pids[i]==0)reached_kernel=1;
    /* Qualified Darwin allproc ordering ends with permanent kernproc (PID 0).
     * libproc can truncate at an internal nprocs+20 capacity below MAX_PIDS. */
    if(!reached_kernel)fail("live process census truncated");
    unsigned found=0,signaled=0,uncertain=0;pid_t uncertain_pid=0;
    for(int i=0;i<count;i++) {
        pid_t pid=pids[i]; struct proc_bsdshortinfo b; audit_token_t token;struct task_unique_info before,after;
        if(pid<2 || pid==getpid())continue;
        if(!unique_for(pid,&before)) {uncertain++;uncertain_pid=pid;continue;}
        if(before.unique>census_identity.unique){uncertain++;uncertain_pid=pid;}
        if(before.unique<owner_unique)continue;
        if(proc_pidinfo(pid,PROC_PIDT_SHORTBSDINFO,1,&b,sizeof(b))!=sizeof(b) || b.pbsi_status==5) {uncertain++;uncertain_pid=pid;continue;}
        if(!unique_for(pid,&after) || after.unique!=before.unique || after.version!=before.version) {uncertain++;uncertain_pid=pid;continue;}
        if(b.pbsi_uid!=getuid() && b.pbsi_ruid!=getuid())continue;
        if(token_for(pid,&token)) {
            /* Unreadable candidates keep the census uncertain. */
            uncertain++;uncertain_pid=pid;continue;
        }
        if(!unique_for(pid,&after) || after.unique!=before.unique || after.version!=before.version
            || !matches(token,pid,(uint32_t)after.version) || audit_token_to_euid(token)!=b.pbsi_uid) {
            uncertain++;uncertain_pid=pid;continue;
        }
        if(audit_token_to_asid(token)!=asid)continue;
        if(matches(token,owner,owner_version) || matches(token,guardian,guardian_version))continue;
        found++;
        int result=proc_signal_with_audittoken(&token,signal_number);
        if(result && result!=ESRCH)fail("token-bound signal rejected");
        if(!result)signaled++;
    }
    free(pids);
    printf("{\"members\":%u,\"signaled\":%u,\"uncertain\":%u,\"uncertain_pid\":%d}\n",found,signaled,uncertain,uncertain_pid);
}
static void probe(pid_t owner) {
    audit_token_t self; mach_msg_type_number_t count=TASK_AUDIT_TOKEN_COUNT;
    if(getuid()==0 || task_info(mach_task_self(),TASK_AUDIT_TOKEN,(task_info_t)&self,&count)!=KERN_SUCCESS)fail("probe identity unavailable");
    au_asid_t asid=audit_token_to_asid(self);
    mach_port_name_t port=MACH_PORT_NULL;
    errno=0;
    if(audit_session_port(asid==100000?100001:100000,&port)!=-1 || errno!=EPERM)fail("foreign audit session access not denied");
    auditinfo_addr_t info={0}; info.ai_asid=AU_ASSIGN_ASID; info.ai_termid.at_type=AU_IPv4;
    errno=0;
    if(setaudit_addr(&info,sizeof(info))!=-1 || errno!=EPERM)fail("audit session creation not denied");
    errno=0;
    if(kill(owner,0)!=-1 || errno!=EPERM)fail("supervisor signal access not denied");
    puts("{\"audit_session_escape_denied\":true,\"supervisor_signal_denied\":true}");
}
int main(int argc,char **argv) {
    if(argc==3 && !strcmp(argv[1],"identity"))identity((pid_t)number(argv[2],INT32_MAX));
    else if(argc==3 && !strcmp(argv[1],"probe"))probe((pid_t)number(argv[2],INT32_MAX));
    else if(argc>1 && !strcmp(argv[1],"sweep"))sweep(argc,argv);
    else fail("invalid command");
    return 0;
}
