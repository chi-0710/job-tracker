package com.chi.jobtracker.common;

import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;

public final class AuthUser {

    private AuthUser() {
    }

    public static UUID id(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }
}
