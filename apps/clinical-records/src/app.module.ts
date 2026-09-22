import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { assertAuthConfig, JwtRolesGuard } from '../../../libs/common/src/oidc';
import { MessagesController } from './messages.controller';
import { NotesController } from './notes.controller';
import { FilesController } from './files.controller';
import { VisitsController } from './visits.controller';
import { PrescriptionScansController } from './prescription-scans.controller';

const jwtConfig = assertAuthConfig();

@Module({
  imports: [
    JwtModule.register({
      secret: jwtConfig.secret,
      signOptions: { issuer: jwtConfig.issuer, audience: jwtConfig.audience },
    }),
  ],
  controllers: [MessagesController, NotesController, FilesController, VisitsController, PrescriptionScansController],
  providers: [JwtRolesGuard],
})
export class AppModule {}
