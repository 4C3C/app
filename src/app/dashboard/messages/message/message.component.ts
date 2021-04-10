import { Component, Input } from '@angular/core';
import { toHTML } from 'discord-markdown';
import { textEmoji } from 'markdown-to-text-emoji';
import { GuildService } from 'src/app/services/guild.service';
import { LogService } from 'src/app/services/log.service';
import { PermissionsService } from 'src/app/services/permissions.service';
import { UsersService } from 'src/app/services/users.service';
import { WSService } from 'src/app/services/ws.service';
import { Lean, PermissionTypes } from 'src/app/types/entity-types';

@Component({
  selector: 'message',
  templateUrl: './message.component.html',
  styleUrls: ['./message.component.css']
})
export class MessagePreviewComponent {
  @Input()
  public message: Lean.Message;
  @Input()
  public isExtra = false;
  @Input()
  public guild: Lean.Guild;
  @Input()
  public member: Lean.GuildMember;

  public embed: MessageEmbed;
  public isEditing = false;

  public get author() {
    return this.usersService.getKnown(this.message.authorId)
      ?? this.usersService.getUnknown(this.message.authorId);
  }
  
  public get roleColor(): string {
    if (!this.guild) return;

    const roleId = this.member?.roleIds[this.member?.roleIds.length - 1];
    return this.guild.roles.find(r => r._id == roleId)?.color;
  }

  public get timestamp() { 
    const createdAt = new Date(this.message.createdAt);
    const timestamp = createdAt.toTimeString().slice(0, 5);
    
    if (this.getDaysAgo(createdAt))
      return `Today at ${timestamp}`;
    else if (this.getDaysAgo(createdAt, -1))
      return `Yesterday at ${timestamp}`;
    else if (this.getDaysAgo(createdAt, 1))
      return `Tomorrow at ${timestamp}`;

    return createdAt
      .toJSON()
      .slice(0,10)
      .split('-')
      .reverse()
      .join('/');
  }
  private getDaysAgo(date: Date, days = 0) {
    return date.getDate() === new Date().getDate() + days
      && date.getMonth() === new Date().getMonth()
      && date.getFullYear() === new Date().getFullYear()
  }
  
  public get timeString() {
    const date = new Date(this.message.createdAt);
    return `${date.toString().slice(16, 21)}`;
  }

  public get isMentioned() {
    return document.querySelector(`#message-${this.message._id} .self-mention`);
  }

  public get processed() {
    const getRole = (id: string) => this.guild?.roles.find(r => r._id === id);
    const getUser = (id: string) => this.usersService.getKnown(id);

    const getMention = (html: string, condition: boolean) => {
      return (condition)
        ? `<span class="self-mention">${html}</span>`
        : html;
    };

    const recipientHasRole = this.guildService
      .getMember(this.guild?._id, this.usersService.user._id)?.roleIds
      .some(id => this.guild?.roles.some(r => r._id === id));
  
    return toHTML(textEmoji(this.message.content), {
      discordCallback: {
        user: (node) => getMention(
          `@${getUser(node.id)?.username ?? `Invalid User`}`,
          this.usersService.user._id === node.id),

        role: (node) => getMention(
          `@${getRole(node.id)?.name ?? `Invalid Role`}`,
          recipientHasRole),

        everyone: (node) => getMention(`@everyone`, true),
        here: (node) => getMention(`@here`, this.usersService.user.status !== 'OFFLINE')
      }
    });
  }

  public get canManage() {
    return this.author._id === this.usersService.user._id
      || (this.guild && this.perms.can(this.guild._id, 'SEND_MESSAGES'));
  }

  constructor(
    private log: LogService,
    private guildService: GuildService,
    private usersService: UsersService,
    private ws: WSService,
    private perms: PermissionsService
  ) {}

  public removeEmbed() {
    this.message.embed = null;
    
    this.ws.emit('MESSAGE_UPDATE', {
      messageId: this.message._id,
      partialMessage: this.message,
      withEmbed: false
    });
  }

  public delete() {
    this.ws.emit('MESSAGE_DELETE', {
      messageId: this.message._id,
    });

    document
      .querySelector(`#message${this.message._id}`)
      ?.remove();
  }

  public edit($event: KeyboardEvent, value: string) {    
    if ($event.code !== 'Enter') return;

    this.message.content = value;
  }
}

interface MessageEmbed {
  title: string;
  description: string;
  image: string;
  url: string;
}