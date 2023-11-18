/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   game.gateway.ts                                    :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: mmarinel <mmarinel@student.42.fr>          +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2023/11/18 10:15:07 by mmarinel          #+#    #+#             */
/*   Updated: 2023/11/18 13:58:34 by mmarinel         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

import { WebSocketGateway, SubscribeMessage, MessageBody, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket } from '@nestjs/websockets';
import { GameService } from './game.service';
import { CreateGameDto } from './dto/create-game.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import { PlayerDto } from './dto/player.dto';
import { Socket, Server } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { FrameDto } from './dto/game.dto';

export class GameSocket {
	user_socket: Socket
	roomId: string
};

@WebSocketGateway({
	cors: {
		origin: process.env.FRONTEND_URL
	},
	namespace: "game"
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {

	@WebSocketServer()
	private server: Server;
	private queue: Map<number, Socket>;
	private games: Map<number, GameSocket>;
	private frames: Map<string, FrameDto>;

	constructor(
		private readonly gameService: GameService,
		private readonly jwtService: JwtService
		)
	{
		this.queue = new Map<number, Socket>();
		this.games = new Map<number, GameSocket>();
		this.frames = new Map<string, FrameDto>();
	}

	async handleConnection(client: Socket, ...args: any[]) {
		const user = await this.jwtService.verifyAsync(client.handshake.auth.token, {
			secret: process.env.JWT_SECRET
		});

		console.log(`socket: ${client.id}, userID: ${Number(user.sub)}, connected`);
		this.queue.set(Number(user.sub), client);
	}

	async handleDisconnect(client: any) {
		console.log(`friendships gateway: ${client.id} disconnected`);
		
		let key: number = -1;
		
		for (let [userID, csock] of this.queue) {
			if (client.id == csock.id) {
				key = userID;
				break ;
			}
		}

		if (-1 != key) {
			console.log(`game gateway: user ${key} socket removed`);
			this.queue.delete(key);
			return ;
		}

		for (let [userID, {user_socket: csock, ...rest}] of this.games) {
			if (client.id == csock.id) {
				key = userID;
				break ;
			}
		}

		if (-1 != key) {
			console.log(`game gateway: user ${key} socket removed`);
			this.games.delete(key);
			return ;
		}
	}

	@SubscribeMessage('createGame')
	create(@MessageBody() createGameDto: CreateGameDto) {
		return this.gameService.create(createGameDto);
	}

	@SubscribeMessage('findAllGame')
	findAll() {
	return this.gameService.findAll();
	}

	@SubscribeMessage('findOneGame')
	findOne(@MessageBody() id: number) {
	return this.gameService.findOne(id);
	}

	@SubscribeMessage('updateGame')
	update(@MessageBody() updateGameDto: UpdateGameDto) {
	return this.gameService.update(updateGameDto.id, updateGameDto);
	}

	@SubscribeMessage('removeGame')
	remove(@MessageBody() id: number) {
	return this.gameService.remove(id);
	}

	/*
	// joining game through invite
	@SubscribeMessage('sendInvite')
	sendInvite(@MessageBody() playerDto: PlayerDto) {
		return this.gameService.sendInvite(playerDto);
	}

	@SubscribeMessage('cancelInvite')
	cancelInvite(@MessageBody() playerDto: PlayerDto) {
		return this.gameService.cancelInvite(playerDto);
	}

	@SubscribeMessage('rejectInvite')
	rejectInvite(@MessageBody() playerDto: PlayerDto) {
		return this.gameService.rejectInvite(playerDto);
	}

	@SubscribeMessage('acceptInvite')
	acceptInvite(@MessageBody() playerDto: PlayerDto) {
		return this.gameService.acceptInvite(playerDto);
	}*/
	// joining game through matchmaking
	@SubscribeMessage('matchMaking')
	matchMaking(
		@MessageBody() playerDto: PlayerDto,
		@ConnectedSocket() playerSocket: Socket
	)
	{
		let matched: boolean = false;
		
		for (let [hostID, hostSocket] of this.queue) {
			if (this.gameService.playerMatch(hostID, playerDto.playerID))
			{
				// create the room
				let roomId = `${playerDto.playerID}:${hostID}`;
				hostSocket.join(roomId);
				playerSocket.join(roomId);

				// update data structures
				let hostGameSocket: GameSocket = {
					user_socket: hostSocket,
					roomId
				};
				let guestGameSocket: GameSocket = {
					user_socket: playerSocket,
					roomId
				};
				this.queue.delete(hostID);
				this.games.set(hostID, hostGameSocket);
				this.games.set(playerDto.playerID, guestGameSocket);

				// emit event in the room
				this.server.to(roomId).emit('newGame', {
					hostID,
					guestID: playerDto.playerID
				} as CreateGameDto);

				// exit loop
				matched = true;
				break ;
			}
		}

		// add to queue if could not find match
		if (false == matched)
		{
			this.queue.set(playerDto.playerID, playerSocket);
		}
	}

	/*
	// customization
	@SubscribeMessage('sendCustomizationOptions')
	sendCustOptions(@MessageBody() playerDto: PlayerDto) {
		return this.gameService.sendCustOptions(playerDto);
	}

	// joining game for livestream
	@SubscribeMessage('joinGame')
	joinGame(@MessageBody() playerDto: PlayerDto) {
		return this.gameService.joinGame(playerDto);
	}*/

	@SubscribeMessage('newFrame')
	getNewFrame(
		@MessageBody() frame: FrameDto
	)
	{
		const	userID: number = frame.hostId || frame.guestID;
		const	roomId: string = this.games.get(userID).roomId;
		const	currentFrame: FrameDto = this.frames.get(roomId);
		let		nextFrame: FrameDto = {} as FrameDto;

		if (frame.seq > currentFrame.seq)
		{
			// update seq number
			Object.assign(nextFrame, currentFrame);
			nextFrame.seq += 1
			this.frames.set(roomId, nextFrame);

			this.server.to(roomId).emit("newFrame", nextFrame);
		}
	}

}