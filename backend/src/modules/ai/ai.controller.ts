import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { AiEngineService } from './ai-engine.service';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly engine: AiEngineService,
  ) {}

  private orgId(req: any, query?: any): Promise<string> {
    return this.ai.resolveOrgId(req.user, query?.organizationId);
  }

  // ─── Config ───────────────────────────────────────────────────────────────

  @Get('config')
  async getConfig(@Req() req: any, @Query() q: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.getConfig(orgId);
  }

  @Patch('config')
  async saveConfig(@Req() req: any, @Query() q: any, @Body() body: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.saveConfig(orgId, body);
  }

  @Post('test')
  async testConnection(@Req() req: any, @Query() q: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.testConnection(orgId);
  }

  // ─── Action policies ──────────────────────────────────────────────────────

  @Get('action-policies')
  async getActionPolicies(@Req() req: any, @Query() q: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.getActionPolicies(orgId);
  }

  @Patch('action-policies')
  async saveActionPolicies(@Req() req: any, @Query() q: any, @Body() body: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.saveActionPolicies(orgId, body.policies ?? body);
  }

  // ─── Business memory ──────────────────────────────────────────────────────

  @Get('memory')
  async getMemory(@Req() req: any, @Query() q: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.getMemory(orgId);
  }

  @Patch('memory')
  async saveMemory(@Req() req: any, @Query() q: any, @Body() body: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.saveMemory(orgId, body);
  }

  @Post('memory/analyze')
  async startAnalysis(@Req() req: any, @Query() q: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.startAnalysis(orgId);
  }

  @Get('memory/analyze/status')
  async getAnalysisStatus(@Req() req: any, @Query() q: any) {
    const orgId = await this.orgId(req, q);
    const mem = await this.ai.getMemory(orgId);
    return {
      status: mem.analyzeStatus,
      progress: mem.analyzeProgress,
      error: mem.analyzeError,
      analyzedAt: mem.analyzedAt,
    };
  }

  // ─── Learning ─────────────────────────────────────────────────────────────

  @Post('memory/learn')
  async startLearning(@Req() req: any, @Query() q: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.startLearning(orgId);
  }

  @Get('memory/learn/status')
  async getLearningStatus(@Req() req: any, @Query() q: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.getLearningStatus(orgId);
  }

  @Get('memory/learn/data')
  async getLearningData(@Req() req: any, @Query() q: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.getLearningData(orgId);
  }

  // ─── Prompts ──────────────────────────────────────────────────────────────

  @Get('prompts')
  async getPrompts(@Req() req: any, @Query() q: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.getPrompts(orgId);
  }

  @Patch('prompts')
  async savePrompts(@Req() req: any, @Query() q: any, @Body() body: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.savePrompts(orgId, body);
  }

  @Post('prompts/generate')
  async generatePrompts(@Req() req: any, @Query() q: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.generatePromptsFromMemory(orgId);
  }

  // ─── Automation rules ─────────────────────────────────────────────────────

  @Get('automation-rules')
  async getRules(@Req() req: any, @Query() q: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.getRules(orgId);
  }

  @Post('automation-rules')
  async createRule(@Req() req: any, @Query() q: any, @Body() body: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.createRule(orgId, body);
  }

  @Patch('automation-rules/:id')
  async updateRule(
    @Req() req: any,
    @Query() q: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const orgId = await this.orgId(req, q);
    return this.ai.updateRule(orgId, id, body);
  }

  @Delete('automation-rules/:id')
  async deleteRule(@Req() req: any, @Query() q: any, @Param('id') id: string) {
    const orgId = await this.orgId(req, q);
    return this.ai.deleteRule(orgId, id);
  }

  // ─── Pending actions ──────────────────────────────────────────────────────

  @Get('pending')
  async getPending(@Req() req: any, @Query() q: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.getPendingActions(orgId, q.status, {
      skip: q.skip ? Number(q.skip) : 0,
      take: q.take ? Number(q.take) : 25,
    });
  }

  @Patch('pending/:id/review')
  async reviewPending(
    @Req() req: any,
    @Query() q: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const orgId = await this.orgId(req, q);
    const updated = await this.ai.reviewPendingAction(orgId, id, {
      decision: body.decision,
      reviewedById: req.user?.id ?? body.reviewedById,
    });

    // ONAYLANDI → action'ı gerçekten çalıştır
    if (body.decision === 'APPROVED') {
      this.engine.executeApprovedAction(updated).catch((err) =>
        console.error(`executeApprovedAction error: ${err.message}`),
      );
    }

    return updated;
  }

  // ─── Logs ─────────────────────────────────────────────────────────────────

  @Get('logs')
  async getLogs(@Req() req: any, @Query() q: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.getLogs(orgId, {
      action: q.action,
      status: q.status,
      contactId: q.contactId,
      from: q.from,
      to: q.to,
      skip: q.skip ? Number(q.skip) : undefined,
      take: q.take ? Number(q.take) : undefined,
    });
  }

  @Get('reports')
  async getReports(@Req() req: any, @Query() q: any) {
    const orgId = await this.orgId(req, q);
    return this.ai.getReports(orgId, {
      from: q.from,
      to: q.to,
    });
  }
}
