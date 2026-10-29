package com.chi.jobtracker.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class AuthDtos {

    private AuthDtos() {
    }

    public record RegisterRequest(
        @NotBlank(message = "邮箱不能为空")
        @Email(message = "邮箱格式不正确")
        @Size(max = 255, message = "邮箱不能超过 255 个字符")
        String email,

        @NotBlank(message = "密码不能为空")
        @Size(min = 8, max = 72, message = "密码长度需在 8-72 位之间")
        String password,

        @Size(max = 100, message = "昵称不能超过 100 个字符")
        String displayName
    ) {
    }

    public record LoginRequest(
        @NotBlank(message = "邮箱不能为空")
        @Email(message = "邮箱格式不正确")
        String email,

        @NotBlank(message = "密码不能为空")
        String password
    ) {
    }

    public record AuthResponse(String accessToken, String tokenType, long expiresIn) {
    }
}
