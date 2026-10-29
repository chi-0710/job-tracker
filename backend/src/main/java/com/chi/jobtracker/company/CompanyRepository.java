package com.chi.jobtracker.company;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CompanyRepository extends JpaRepository<Company, UUID> {

    List<Company> findByUserIdAndDeletedAtIsNullOrderByUpdatedAtDesc(UUID userId);

    Optional<Company> findByIdAndUserIdAndDeletedAtIsNull(UUID id, UUID userId);

    @Query("""
        select distinct c from Company c
        where c.userId = :userId and c.deletedAt is null
          and (lower(c.name) like lower(concat('%', :keyword, '%'))
               or exists (
                   select 1 from Position p
                   where p.companyId = c.id and p.deletedAt is null
                     and lower(p.title) like lower(concat('%', :keyword, '%'))
               ))
        order by c.updatedAt desc
        """)
    List<Company> search(@Param("userId") UUID userId, @Param("keyword") String keyword);
}
