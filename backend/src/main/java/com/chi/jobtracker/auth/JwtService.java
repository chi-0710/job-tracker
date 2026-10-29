package com.chi.jobtracker.auth;

import java.time.Duration;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

@Service
public class JwtService {

    private final JwtEncoder jwtEncoder;
    private final Duration ttl;

    public JwtService(JwtEncoder jwtEncoder, @Value("${app.jwt.ttl}") Duration ttl) {
        this.jwtEncoder = jwtEncoder;
        this.ttl = ttl;
    }

    public AuthDtos.AuthResponse issue(AppUser user) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
            .issuer("job-tracker")
            .subject(user.getId().toString())
            .claim("email", user.getEmail())
            .issuedAt(now)
            .expiresAt(now.plus(ttl))
            .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        String token = jwtEncoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return new AuthDtos.AuthResponse(token, "Bearer", ttl.toSeconds());
    }
}
