package com.chi.jobtracker.position;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PositionRepository extends JpaRepository<Position, UUID> {

    List<Position> findByCompanyIdAndUserIdAndDeletedAtIsNullOrderByUpdatedAtDesc(UUID companyId, UUID userId);

    List<Position> findByUserIdAndDeletedAtIsNull(UUID userId);

    Optional<Position> findByIdAndUserIdAndDeletedAtIsNull(UUID id, UUID userId);

    @Modifying
    @Query("""
        update Position p set p.deletedAt = :deletedAt
        where p.companyId = :companyId and p.deletedAt is null
        """)
    int softDeleteByCompanyId(@Param("companyId") UUID companyId, @Param("deletedAt") Instant deletedAt);
}
