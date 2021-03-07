import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { GuildService } from 'src/app/services/guild.service';
import { UsersService } from 'src/app/services/users.service';
import { FormControl } from '@angular/forms';
import { WSService } from 'src/app/services/ws.service';
import { LogService } from 'src/app/services/log.service';
import { ChannelService } from 'src/app/services/channel.service';
import { PermissionsService } from 'src/app/services/permissions.service';

@Component({
  selector: 'app-text-channel',
  templateUrl: './text-channel.component.html',
  styleUrls: ['./text-channel.component.css']
})
export class TextChannelComponent implements OnInit {
  @ViewChild('notificationSound') notificationSound: ElementRef;

  activeChannelId: string;
  channel: any;
  guild: any;

  get channelMessages() {
    return this.channelService.getMessageMap(this.guild._id);
  }
  get messages() {
    return this.channelMessages.get(this.activeChannelId);
  }

  loadedAllMessages = false;  
  emojiPickerOpen = false;

  chatBox = new FormControl();
  typingUserIds = [];

  get typingUsernames() {
    return this.typingUserIds
      .map(id => this.userService
        .getKnown(id).username);
  }

  private lastTypingEmissionAt = null;

  get onlineMembers() {
    return this.guild.members.filter(m => {
      const user = this.userService.getKnown(m.userId);
      return user.status !== 'OFFLINE';
    });
  }
  get offlineMembers() {
    return this.guild.members.filter(m => {
      const user = this.userService.getKnown(m.userId);
      return user.status === 'OFFLINE';
    });
  }

  constructor(
    private channelService: ChannelService,
    public guildService: GuildService,
    private log: LogService,
    private route: ActivatedRoute,
    public userService: UsersService,
    public perms: PermissionsService,
    private ws: WSService) {}

  async ngOnInit() {
    await this.userService.init();
    await this.guildService.init();

    this.route.paramMap.subscribe(async(paramMap) => {
      const guildId = paramMap.get('guildId');
      const channelId = this.activeChannelId = paramMap.get('channelId');
  
      this.guild = this.guildService.getGuild(guildId);
      this.channel = this.guild?.channels
        .find(c => c._id === channelId);
      
      document.title = `#${this.channel.name}`;
  
      this.channelMessages.set(
        this.activeChannelId,
        await this.channelService.getMessages(guildId, channelId)
      );
      this.loadedAllMessages = this.messages.length < 25;
      
      setTimeout(() => this.scrollToMessage(), 100);
      
      this.hookWSEvents();
      this.initCtxMenuEvents();
    });
  }

  private initCtxMenuEvents() {
    document
      .querySelectorAll('.ctx-menu')
      .forEach((el: HTMLElement) => window
        .addEventListener('click', () => el.style.display = 'none'));
  }

  public hookWSEvents() {
    this.ws.on('TYPING_START', ({ userId }) => {
      const selfIsTyping = this.typingUserIds.includes(this.userService.user._id);
      if (!selfIsTyping)
        this.typingUserIds.push(userId);

      setTimeout(() => this.stopTyping(userId), 5.1 * 1000);
    }, this)
    .on('MESSAGE_CREATE', async ({ message }) => {      
      if (message.authorId !== this.userService.user._id)
        try {
          await (this.notificationSound.nativeElement as HTMLAudioElement).play();
        } catch {}
      
      if (message.channelId === this.activeChannelId)
        this.messages.push(message);
      else {
        const messages = this.channelMessages.get(message.channelId);
        this.channelMessages.set(message.channelId, messages.concat(message));
      }

      setTimeout(() => this.scrollToMessage(), 100);
    }, this)
    .on('MESSAGE_UPDATE', ({ messageId, partialMessage }) => {
      
      let index = this.messages.findIndex(m => m._id === messageId);
      this.messages[index] = {
        ...this.messages[index],
        ...partialMessage,
      };      
    }, this)
    .on('MESSAGE_DELETE', ({ messageId }) => {
      
      let index = this.messages.findIndex(m => m._id === messageId);
      this.messages.splice(index, 1);
    }, this);
  }

  public emitTypingStart() { 
    const sinceLastTyped = new Date().getTime() - this.lastTypingEmissionAt?.getTime();    
    if (sinceLastTyped < 5 * 1000) return;

    this.log.info('SEND TYPING_START', 'text');
    
    this.ws.emit('TYPING_START',
      { channelId: this.channel._id, userId: this.userService.user._id });

    this.lastTypingEmissionAt = new Date();
  }
  private stopTyping(userId: string) {
    const index = this.typingUserIds.indexOf(userId);
    this.typingUserIds.splice(index, 1);
  }

  private scrollToMessage(end?: number) {
    const messages = document.querySelector('.messages');

    let combinedHeight = 0;    
    Array.from(document.querySelectorAll(`.message-preview`))
      .slice(0, end ?? this.messages.length)
      .forEach(e => combinedHeight += e.scrollHeight);

    messages.scrollTop = (end)
      ? messages.scrollHeight - combinedHeight
      : combinedHeight;
  }

  chat(content: string) {
    if (!content.trim()) return;
    
    (document.querySelector('#chatBox') as HTMLInputElement).value = '';
    
    this.ws.emit('MESSAGE_CREATE', {
      partialMessage: {
        authorId: this.userService.user._id,
        channelId: this.channel._id,
        content,
        guildId: this.guild._id,
      }
    });

    this.stopTyping(this.userService.user);
  }
  
  shouldCombine(index: number) {
    const lastMessage = (index) ? this.messages[Math.max(0, index - 1)] : null;
    if (!lastMessage)
      return false;

    const message = this.messages[index];

    const isSameAuthor = message.authorId === lastMessage?.authorId;
    const duringSameHour = new Date(message.createdAt)
      .getHours() === new Date(lastMessage?.createdAt).getHours();    

    return isSameAuthor && duringSameHour;
  }

  async loadMoreMessages() {
    if (this.loadedAllMessages) return;

    this.log.info('Loading more messages', 'text');

    const moreMessages = await this.channelService
      .getMessages(this.guild._id, this.channel._id, {
        start: this.messages.length,
        end: this.messages.length + 25
      });    
    
    this.scrollToMessage(this.messages.length);

    this.loadedAllMessages = moreMessages.length < this.messages.length + 25;
    this.channelMessages.set(
      this.activeChannelId, 
      moreMessages
        .concat(this.messages)
        .sort((a, b) => new Date(a.createdAt) > new Date(b.createdAt) ? 1 : -1)
    );
  }

  // emoji picker
  addEmoji({ emoji }) {
    console.log(emoji.native);
    (document.querySelector('#chatBox') as HTMLInputElement).value += emoji.native;
  }

  onClick({ path }) {
    const emojiPickerWasClicked = path
      .some(n => n && n.nodeName === 'EMOJI-MART' || n.classList?.contains('emoji-icon'));
    this.emojiPickerOpen = emojiPickerWasClicked;
  }

  // manage users
  kickMember(user: any) {
    console.log(user);    
  }
}
