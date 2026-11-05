import type { HttpClient } from '../http.js';
import type { ContextPacketCreateInput, ContextPacketDTO } from '@proofmesh/contracts';

export class ContextPacketsModule {
  constructor(private readonly http: HttpClient) {}

  /**
   * Registers a bounded context packet containing curated evidence passages and tokens.
   */
  public async create(input: ContextPacketCreateInput): Promise<ContextPacketDTO> {
    return this.http.request<ContextPacketDTO>('/v1/context-packets', 'POST', input);
  }

  /**
   * Retrieves a context packet by ID.
   */
  public async get(packetId: string): Promise<ContextPacketDTO> {
    return this.http.request<ContextPacketDTO>(`/v1/context-packets/${packetId}`, 'GET');
  }
}
