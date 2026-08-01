(() => {
  const $ = (id) => document.getElementById(id);
  const state = { user:null, conversations:[], users:[], current:null, messages:[], filter:"all", search:"", reply:null, attachment:null, lastPoll:null, typingSentAt:0 };

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials:"same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function esc(value="") { return String(value).replace(/[&<>'"]/g,(ch)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch])); }
  function initials(name="F") { return String(name).split(/\s+/).filter(Boolean).slice(0,2).map((p)=>p[0]).join("").toUpperCase() || "F"; }
  function timeAgo(value) { const date=new Date(value); const diff=Date.now()-date.getTime(); if(!Number.isFinite(diff))return""; if(diff<60000)return"now"; if(diff<3600000)return`${Math.floor(diff/60000)}m`; if(diff<86400000)return`${Math.floor(diff/3600000)}h`; return date.toLocaleDateString([], {month:"short",day:"numeric"}); }
  function fullTime(value){ return new Date(value).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}); }
  function toast(message){ const node=$("chat-toast"); node.textContent=message; node.hidden=false; clearTimeout(toast.timer); toast.timer=setTimeout(()=>node.hidden=true,3200); }

  function conversationName(conversation){ return conversation.title || (conversation.type === "global" ? "Everyone" : conversation.otherUser?.username || "Direct message"); }
  function conversationSubtitle(conversation){ if(conversation.type === "global") return "Everyone on Fuzz"; return conversation.otherUser?.online ? "Online" : conversation.otherUser?.lastSeenAt ? `Active ${timeAgo(conversation.otherUser.lastSeenAt)} ago` : "Direct message"; }

  function renderConversations(){
    const root=$("conversation-list");
    const q=state.search.toLowerCase();
    const rows=state.conversations.filter((conversation)=>{
      if(state.filter==="unread" && Number(conversation.unreadCount||0)<1)return false;
      if(state.filter==="dm" && conversation.type!=="dm")return false;
      return !q || conversationName(conversation).toLowerCase().includes(q) || String(conversation.lastMessage?.body||"").toLowerCase().includes(q);
    });
    if(!rows.length){root.innerHTML='<div class="chat-loading">No conversations found.</div>';return;}
    root.innerHTML=rows.map((conversation)=>`<button class="conversation-item${state.current?.id===conversation.id?" is-active":""}" type="button" data-conversation-id="${conversation.id}">
      <span class="conversation-item-avatar">${conversation.type==="global"?'<i class="fa-solid fa-users"></i>':esc(initials(conversation.otherUser?.username))}</span>
      <span class="conversation-item-copy"><span class="conversation-item-line"><strong>${esc(conversationName(conversation))}</strong><time>${conversation.lastMessage?timeAgo(conversation.lastMessage.createdAt):""}</time></span><p>${esc(conversation.lastMessage?.body || conversationSubtitle(conversation))}</p></span>
      ${Number(conversation.unreadCount||0)>0?`<span class="unread-pill">${Math.min(99,Number(conversation.unreadCount))}</span>`:""}
    </button>`).join("");
    root.querySelectorAll("[data-conversation-id]").forEach((button)=>button.addEventListener("click",()=>openConversation(button.dataset.conversationId)));
  }

  function renderHeader(){
    const header=$("conversation-header");
    if(!state.current){return;}
    header.querySelector(".conversation-avatar").innerHTML=state.current.type==="global"?'<i class="fa-solid fa-users"></i>':esc(initials(state.current.otherUser?.username));
    header.querySelector("strong").textContent=conversationName(state.current);
    header.querySelector("span").textContent=conversationSubtitle(state.current);
    $("conversation-menu-button").disabled=state.current.type !== "dm";
  }

  function reactionHtml(message){
    return (message.reactions||[]).map((reaction)=>`<button class="message-reaction${reaction.mine?" is-mine":""}" type="button" data-react="${esc(reaction.emoji)}" data-message-id="${message.id}">${esc(reaction.emoji)} ${reaction.count}</button>`).join("");
  }

  function renderMessages(scroll=true){
    const root=$("message-list");
    if(!state.messages.length){root.innerHTML='<div class="chat-empty-state"><span><i class="fa-regular fa-message"></i></span><h2>No messages yet</h2><p>Start the conversation.</p></div>';return;}
    root.innerHTML=state.messages.map((message)=>`<article class="message-row" data-message-id="${message.id}">
      <span class="message-author-avatar">${esc(initials(message.sender?.username))}</span>
      <div class="message-content">
        ${message.replyTo?`<div class="message-reply-preview"><strong>${esc(message.replyTo.sender?.username||"User")}</strong> · ${esc(message.replyTo.body||"Message")}</div>`:""}
        <div class="message-meta"><strong>${esc(message.sender?.username||"Unknown")}</strong><time title="${esc(fullTime(message.createdAt))}">${timeAgo(message.createdAt)}</time>${message.editedAt?"<em>edited</em>":""}</div>
        <div class="message-body">${message.deletedAt?"<em>Message deleted</em>":esc(message.body)}</div>
        ${message.attachmentUrl?`<img class="message-attachment" src="${esc(message.attachmentUrl)}" alt="Chat attachment" loading="lazy" />`:""}
        <div class="message-reactions">${reactionHtml(message)}</div>
        ${message.deletedAt?"":`<div class="message-actions"><button type="button" data-message-action="reply">Reply</button><button type="button" data-message-action="react">React</button>${message.mine?'<button type="button" data-message-action="edit">Edit</button><button type="button" data-message-action="delete">Delete</button>':'<button type="button" data-message-action="report">Report</button>'}</div>`}
      </div>
    </article>`).join("");
    root.querySelectorAll("[data-message-action]").forEach((button)=>button.addEventListener("click",()=>handleMessageAction(button.closest("[data-message-id]").dataset.messageId,button.dataset.messageAction)));
    root.querySelectorAll("[data-react]").forEach((button)=>button.addEventListener("click",()=>toggleReaction(button.dataset.messageId,button.dataset.react)));
    if(scroll) root.scrollTop=root.scrollHeight;
  }

  async function loadBootstrap(){
    const data=await request("/api/chat/bootstrap");
    state.user=data.user; state.conversations=data.conversations||[]; state.users=data.users||[];
    $("chat-reports-button").hidden = !["owner", "admin", "moderator"].includes(state.user?.role);
    $("online-count").innerHTML=`<i class="fa-solid fa-circle"></i> ${Number(data.onlineCount||1)} online`;
    renderConversations();
    const requested=new URLSearchParams(location.search).get("conversation");
    const first=requested || state.conversations.find((item)=>item.type==="global")?.id || state.conversations[0]?.id;
    if(first) await openConversation(first);
  }

  async function refreshBootstrap(){
    const data=await request("/api/chat/bootstrap");
    state.conversations=data.conversations||[]; state.users=data.users||[];
    $("online-count").innerHTML=`<i class="fa-solid fa-circle"></i> ${Number(data.onlineCount||1)} online`;
    const updated=state.conversations.find((item)=>item.id===state.current?.id); if(updated)state.current=updated;
    renderConversations(); renderHeader();
  }

  async function openConversation(id){
    const conversation=state.conversations.find((item)=>item.id===id); if(!conversation)return;
    state.current=conversation; state.reply=null; updateReply(); renderConversations(); renderHeader();
    $("message-input").disabled=false; $("message-input").placeholder=`Message ${conversationName(conversation)}`; $("message-send-button").disabled=false; $("chat-attachment-button").disabled=false;
    $("message-list").innerHTML='<div class="chat-loading"><span></span>Loading messages…</div>';
    const data=await request(`/api/chat/conversations/${id}/messages?limit=100`);
    state.messages=data.messages||[]; state.lastPoll=data.serverTime||new Date().toISOString(); renderMessages(true);
    await request(`/api/chat/conversations/${id}/read`,{method:"POST"}).catch(()=>{});
    const local=state.conversations.find((item)=>item.id===id); if(local)local.unreadCount=0; renderConversations();
    history.replaceState(null,"",`/chat?conversation=${encodeURIComponent(id)}`);
  }

  function updateReply(){
    const banner=$("reply-banner");
    if(!state.reply){banner.hidden=true;return;}
    $("reply-label").textContent=`${state.reply.sender?.username||"User"}: ${state.reply.body}`; banner.hidden=false;
  }

  function handleMessageAction(id,action){
    const message=state.messages.find((item)=>item.id===id); if(!message)return;
    if(action==="reply"){state.reply=message;updateReply();$("message-input").focus();return;}
    if(action==="react"){const emoji=prompt("Reaction emoji", "👍"); if(emoji)toggleReaction(id,emoji.slice(0,8));return;}
    if(action==="edit"){const body=prompt("Edit message",message.body); if(body!==null)editMessage(id,body);return;}
    if(action==="delete"){if(confirm("Delete this message?"))deleteMessage(id);return;}
    if(action==="report"){const reason=prompt("Why are you reporting this message?","Inappropriate message"); if(reason)reportMessage(id,reason);}
  }

  async function editMessage(id,body){
    try{const data=await request(`/api/chat/messages/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({body})}); const index=state.messages.findIndex((item)=>item.id===id); if(index>=0)state.messages[index]=data.message; renderMessages(false);}catch(error){toast(error.message)}
  }
  async function deleteMessage(id){try{await request(`/api/chat/messages/${id}`,{method:"DELETE"}); const message=state.messages.find((item)=>item.id===id); if(message){message.deletedAt=new Date().toISOString();message.body="";message.attachmentUrl="";}renderMessages(false);}catch(error){toast(error.message)}}
  async function reportMessage(id,reason){try{await request(`/api/chat/messages/${id}/report`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason})});toast("Message reported to the Fuzz team.");}catch(error){toast(error.message)}}
  async function toggleReaction(id,emoji){try{await request(`/api/chat/messages/${id}/reactions`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({emoji})});await pollMessages(true);}catch(error){toast(error.message)}}

  async function fileToDataUrl(file){ if(!["image/png","image/jpeg","image/webp"].includes(file.type))throw new Error("Use a PNG, JPEG, or WebP image."); if(file.size>8*1024*1024)throw new Error("Chat images must be 8 MB or smaller."); return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error("Image could not be read."));reader.readAsDataURL(file);}); }
  function renderAttachment(){const root=$("attachment-preview");if(!state.attachment){root.hidden=true;root.innerHTML="";return;}root.hidden=false;root.innerHTML=`<img src="${state.attachment.dataUrl}" alt="Attachment preview"/><button type="button" aria-label="Remove attachment"><i class="fa-solid fa-xmark"></i></button>`;root.querySelector("button").addEventListener("click",()=>{state.attachment=null;renderAttachment();});}

  async function sendMessage(){
    if(!state.current)return; const input=$("message-input"); const body=input.value.trim(); if(!body&&!state.attachment)return;
    $("message-send-button").disabled=true;
    try{
      const data=await request(`/api/chat/conversations/${state.current.id}/messages`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body,replyTo:state.reply?.id||null,attachment:state.attachment})});
      state.messages.push(data.message); input.value=""; input.style.height="auto"; state.reply=null; state.attachment=null; updateReply();renderAttachment();renderMessages(true); await refreshBootstrap();
    }catch(error){toast(error.message)} finally{$("message-send-button").disabled=false;}
  }

  async function pollMessages(silent=false){
    if(!state.current)return;
    try{
      const data=await request(`/api/chat/conversations/${state.current.id}/messages?limit=100`);
      const signature=(messages)=>messages.map((message)=>{
        const reactions=(message.reactions||[]).map((reaction)=>`${reaction.emoji}:${reaction.count}:${reaction.mine?1:0}`).join(",");
        return `${message.id}:${message.editedAt||""}:${message.deletedAt||""}:${message.body||""}:${reactions}`;
      }).join("|");
      const oldSignature=signature(state.messages);
      const newMessages=data.messages||[]; const newSignature=signature(newMessages);
      if(oldSignature!==newSignature){const nearBottom=$("message-list").scrollHeight-$("message-list").scrollTop-$("message-list").clientHeight<120;state.messages=newMessages;renderMessages(nearBottom);}
      await request(`/api/chat/conversations/${state.current.id}/read`,{method:"POST"}).catch(()=>{});
      await refreshTyping(); if(!silent)await refreshBootstrap();
    }catch(error){if(!silent)console.error(error);}
  }

  async function sendTyping(){if(!state.current||Date.now()-state.typingSentAt<1800)return;state.typingSentAt=Date.now();request(`/api/chat/conversations/${state.current.id}/typing`,{method:"POST"}).catch(()=>{});}
  async function refreshTyping(){if(!state.current)return;try{const data=await request(`/api/chat/conversations/${state.current.id}/typing`);const names=(data.users||[]).map((u)=>u.username);const node=$("typing-indicator");node.hidden=!names.length;node.querySelector("em").textContent=names.length===1?`${names[0]} is typing`:`${names.slice(0,2).join(", ")} are typing`;}catch{}}

  function openDmModal(){
    const root=$("chat-modal-root"); root.innerHTML=`<div class="chat-modal-backdrop"><section class="chat-modal"><header><h2>New direct message</h2><button type="button" data-close><i class="fa-solid fa-xmark"></i></button></header><input id="dm-user-search" type="search" placeholder="Search people" autocomplete="off"/><div id="dm-user-list" class="dm-user-list"></div></section></div>`;
    const render=(query="")=>{const q=query.toLowerCase();const users=state.users.filter((user)=>!q||user.username.toLowerCase().includes(q));$("dm-user-list").innerHTML=users.length?users.map((user)=>`<button class="dm-user" type="button" data-user-id="${user.id}"><span>${esc(initials(user.username))}</span><span><strong>${esc(user.username)}</strong><small>${user.online?"Online":user.role}</small></span></button>`).join(""):'<div class="chat-loading">No users found.</div>';$("dm-user-list").querySelectorAll("[data-user-id]").forEach((button)=>button.addEventListener("click",()=>createDm(button.dataset.userId)));};
    render(); $("dm-user-search").addEventListener("input",(event)=>render(event.target.value)); root.querySelector("[data-close]").addEventListener("click",()=>root.innerHTML=""); root.querySelector(".chat-modal-backdrop").addEventListener("click",(event)=>{if(event.target.classList.contains("chat-modal-backdrop"))root.innerHTML="";});
  }

  async function createDm(userId){try{const data=await request("/api/chat/dms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId})});$("chat-modal-root").innerHTML="";await refreshBootstrap();await openConversation(data.conversation.id);}catch(error){toast(error.message)}}

  async function openReportsModal(){
    const root=$("chat-modal-root");
    root.innerHTML='<div class="chat-modal-backdrop"><section class="chat-modal chat-report-modal"><header><div><p>Moderation</p><h2>Open chat reports</h2></div><button type="button" data-close><i class="fa-solid fa-xmark"></i></button></header><div id="chat-report-list" class="chat-report-list"><div class="chat-loading"><span></span>Loading reports…</div></div></section></div>';
    root.querySelector("[data-close]").addEventListener("click",()=>root.innerHTML="");
    try{
      const data=await request("/api/admin/chat/reports?status=open");
      const reports=data.reports||[];
      const list=$("chat-report-list");
      list.innerHTML=reports.length?reports.map((report)=>`<article class="chat-report-card" data-report-id="${esc(report.id)}">
        <header><span><strong>${esc(report.message?.sender?.username||"Unknown sender")}</strong><small>Reported by ${esc(report.reporter?.username||"Unknown")} · ${esc(timeAgo(report.createdAt))}</small></span><span class="chat-report-status">Open</span></header>
        <p class="chat-report-reason"><strong>Reason:</strong> ${esc(report.reason)}</p>
        <blockquote>${esc(report.message?.body||"Message unavailable")}</blockquote>
        ${report.message?.attachmentUrl?`<img src="${esc(report.message.attachmentUrl)}" alt="Reported attachment"/>`:""}
        <footer><button type="button" data-report-action="dismiss">Dismiss</button><button type="button" data-report-action="resolve">Resolve</button><button class="danger" type="button" data-report-action="delete">Delete message</button></footer>
      </article>`).join(""):'<div class="chat-empty-state compact"><span><i class="fa-solid fa-circle-check"></i></span><h2>No open reports</h2><p>The community queue is clear.</p></div>';
      list.querySelectorAll("[data-report-action]").forEach((button)=>button.addEventListener("click",async()=>{
        const card=button.closest("[data-report-id]");
        const action=button.dataset.reportAction;
        if(action==="delete"&&!confirm("Delete the reported message and resolve the report?"))return;
        button.disabled=true;
        try{
          await request(`/api/admin/chat/reports/${card.dataset.reportId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:action==="dismiss"?"dismissed":"resolved",deleteMessage:action==="delete"})});
          card.remove();
          if(!list.querySelector("[data-report-id]"))list.innerHTML='<div class="chat-empty-state compact"><span><i class="fa-solid fa-circle-check"></i></span><h2>No open reports</h2><p>The community queue is clear.</p></div>';
          toast(action==="delete"?"Message deleted and report resolved.":"Report updated.");
          if(action==="delete")await pollMessages(true);
        }catch(error){toast(error.message);button.disabled=false;}
      }));
    }catch(error){$("chat-report-list").innerHTML=`<div class="chat-loading">${esc(error.message)}</div>`;}
  }

  async function blockCurrentUser(){
    const other=state.current?.otherUser;
    if(!other)return;
    if(!confirm(`Block ${other.username}? They will no longer appear in your direct-message list.`))return;
    try{
      await request(`/api/chat/users/${other.id}/block`,{method:"POST"});
      state.current=null;state.messages=[];
      $("message-list").innerHTML='<div class="chat-empty-state"><span><i class="fa-regular fa-message"></i></span><h2>Conversation hidden</h2><p>The user has been blocked.</p></div>';
      $("message-input").disabled=true;$("message-send-button").disabled=true;$("chat-attachment-button").disabled=true;$("conversation-menu-button").disabled=true;
      await refreshBootstrap();toast(`${other.username} was blocked.`);
    }catch(error){toast(error.message)}
  }

  document.addEventListener("DOMContentLoaded", async()=>{
    $("new-dm-button").addEventListener("click",openDmModal);
    $("conversation-search").addEventListener("input",(event)=>{state.search=event.target.value;renderConversations();});
    document.querySelectorAll("[data-chat-filter]").forEach((button)=>button.addEventListener("click",()=>{document.querySelectorAll("[data-chat-filter]").forEach((node)=>node.classList.remove("is-active"));button.classList.add("is-active");state.filter=button.dataset.chatFilter;renderConversations();}));
    $("chat-reports-button").addEventListener("click",openReportsModal);
    $("refresh-chat").addEventListener("click",()=>pollMessages(false));
    $("conversation-menu-button").addEventListener("click",blockCurrentUser);
    $("cancel-reply").addEventListener("click",()=>{state.reply=null;updateReply();});
    $("message-form").addEventListener("submit",(event)=>{event.preventDefault();sendMessage();});
    $("message-input").addEventListener("keydown",(event)=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();sendMessage();}});
    $("message-input").addEventListener("input",(event)=>{event.target.style.height="auto";event.target.style.height=`${Math.min(145,event.target.scrollHeight)}px`;sendTyping();});
    $("chat-attachment-button").addEventListener("click",()=>$("chat-attachment-input").click());
    $("chat-attachment-input").addEventListener("change",async()=>{try{const file=$("chat-attachment-input").files?.[0];if(file)state.attachment={dataUrl:await fileToDataUrl(file),filename:file.name};renderAttachment();}catch(error){toast(error.message)}finally{$("chat-attachment-input").value="";}});
    try{await loadBootstrap();}catch(error){$("conversation-list").innerHTML=`<div class="chat-loading">${esc(error.message)}</div>`;toast(error.message);}
    setInterval(()=>pollMessages(true),3000); setInterval(()=>refreshBootstrap().catch(()=>{}),12000);
  });
})();
