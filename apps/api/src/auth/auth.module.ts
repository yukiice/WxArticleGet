import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AdminGuard } from './admin.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('AUTH_SECRET') ?? 'wx-article-hub-dev-secret';
        // 生产环境使用内置默认密钥等于没有签名校验，宁可不启动也不能静默降低安全边界。
        if ((config.get<string>('NODE_ENV') ?? 'development') === 'production' && secret === 'wx-article-hub-dev-secret') {
          throw new Error('生产环境必须设置 AUTH_SECRET（随机长字符串），不能使用内置默认值');
        }
        return { secret };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AdminGuard],
  exports: [AuthService, AdminGuard, JwtModule],
})
export class AuthModule {}
