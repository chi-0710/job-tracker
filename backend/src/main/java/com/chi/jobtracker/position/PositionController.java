package com.chi.jobtracker.position;

import com.chi.jobtracker.common.AuthUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class PositionController {

    private final PositionService positionService;

    public PositionController(PositionService positionService) {
        this.positionService = positionService;
    }

    @GetMapping("/companies/{companyId}/positions")
    public List<PositionDtos.Response> list(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID companyId) {
        return positionService.list(AuthUser.id(jwt), companyId);
    }

    @PostMapping("/companies/{companyId}/positions")
    @ResponseStatus(HttpStatus.CREATED)
    public PositionDtos.Response create(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID companyId,
            @Valid @RequestBody PositionDtos.Request request) {
        return positionService.create(AuthUser.id(jwt), companyId, request);
    }

    @PatchMapping("/positions/{positionId}")
    public PositionDtos.Response update(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID positionId,
            @Valid @RequestBody PositionDtos.Request request) {
        return positionService.update(AuthUser.id(jwt), positionId, request);
    }

    @DeleteMapping("/positions/{positionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID positionId) {
        positionService.delete(AuthUser.id(jwt), positionId);
    }
}
